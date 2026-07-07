/**
 * @file 白板核心
 * @description
 * BoardCore 是白板在 Worker 中的纯数据实现，承载对象注册、区块加载、AOM、UndoTree、持久化协调等职责。
 * 不依赖 DevicesDAG、DOM、signalsEventBus。
 * @module core/worker/components/orchestration/board-core
 * @author Zhou Chenyu
 */

import { BasicObject } from "../../../shared/objects/basic-obj.js";
import { deserialize } from "../../../shared/objects/object-deserializer.js";
import { EventBus } from "../../../utils/event-bus.js";
import { Logger } from "../../../../utils/log/logger.js";
import { logBus } from "../../../../utils/log/log-bus.js";
import { UndoTree } from "../../../shared/hit/undo-tree-core.js";
import { ActiveObjectManager } from "../../../shared/components/orchestration/active-object-manager.js";
import { createDefaultAomRenderHooks } from "../../../shared/components/orchestration/aom-render-hooks.js";
import {
  CHUNK_LOAD_EVENTS,
  CHUNK_LOAD_STRATEGIES,
  ChunkLoader,
} from "../../../shared/components/chunk/chunk-loader.js";
import { Chunk } from "../../../shared/components/chunk/chunk.js";
import { createDefaultPersistenceAdapter } from "../../../bridges/persistence-adapter.js";

/**
 * @typedef {Object} BoardChunkLoadedState
 * @property {Chunk} chunk - 当前区块实例
 * @property {number} tempLoadedCount - 临时加载计数
 * @property {number} fullLoadedCount - 完整加载计数
 * @property {Map<number | string, "temp" | "full">} loaderStrategy - 各 ChunkLoader 当前持有策略
 */

/**
 * @typedef {Object} BoardObjectLoadedState
 * @property {BasicObject} obj - 对象实例
 * @property {number} loadedCount - 当前对象被完整加载持有的总计数
 */

/**
 * @typedef {Object} AomRenderHooks
 * @property {(objectInstances: BasicObject[]) => void} requestLiveRender
 * @property {(chunks: import("../../../shared/components/chunk/chunk.js").Chunk[]) => void} requestBaseRender
 * @property {(objectInstances: BasicObject[], fallbackChunks: import("../../../shared/components/chunk/chunk.js").Chunk[], previousWorldRects: Map<number, import("../../../shared/range/index.js").RectangleRange>) => void} requestBaseRenderForObjects
 * @property {(objectInstances: BasicObject[]) => void} flushViewportForObjects
 */

/**
 * @typedef {Object} PersistenceAdapter
 * @property {(chunkId: number) => Promise<{ tierGraph: any[], objectCoverIndex: any[] }>} loadChunkMetadata
 * @property {(chunkId: number, metadata: { tierGraph: any[], objectCoverIndex: any[] }) => Promise<boolean>} saveChunkMetadata
 * @property {(objectIds: number[]) => Promise<object[]>} loadObjects
 * @property {(objects: object[]) => Promise<boolean>} saveObjects
 * @property {(objectId: number) => Promise<boolean>} deleteObject
 */

/**
 * 白板核心类
 * @description
 * BoardCore 是白板在 Worker 中的纯数据/逻辑实现。
 * - 承载对象注册表（objectLoaded）、区块加载状态（chunkLoaded）、CounterPool、UndoTree、AOM
 * - 通过注入式 persistenceAdapter 完成文件读写，不直接依赖 file-operate-bridge-renderer
 * - 通过注入式 renderHooks 消除 AOM 对 viewport/renderer 的直接依赖
 * - 不持有 DevicesDAG、signalsEventBus、DOM 引用
 * @class
 * @author Zhou Chenyu
 */
class BoardCore {
  /**
   * 时间回溯树
   * @type {UndoTree}
   */
  undoTree;

  /**
   * 活动对象管理器
   * @type {ActiveObjectManager}
   */
  activeObjectManager;

  /**
   * 当前已知区块的统一加载状态
   * @type {Map<number, BoardChunkLoadedState>}
   */
  chunkLoaded;

  /**
   * 白板级对象实例注册表
   * @type {Map<number, BoardObjectLoadedState>}
   */
  objectLoaded;

  /**
   * 白板的高度
   * @type {number}
   */
  height;

  /**
   * 白板的宽度
   * @type {number}
   */
  width;

  /**
   * 白板的文件根路径
   * @type {string | undefined}
   */
  rootPath;

  /**
   * 区块加载事件总线
   * @type {EventBus}
   */
  chunkLoadEventBus;

  /**
   * 根区块加载器
   * @type {ChunkLoader}
   */
  rootChunkLoader;

  /**
   * 持久化适配器
   * @description 用于替代直接 import boardFileOperateBridge。
   *   内存模式使用 createDefaultPersistenceAdapter()，文件模式使用 createRendererPersistenceAdapter()。
   * @type {PersistenceAdapter}
   */
  persistenceAdapter;

  /**
   * AOM 渲染钩子
   * @description 注入式渲染钩子，替代 AOM 对 viewport/liveRenderer/baseRenderer 的直接访问。
   * @type {AomRenderHooks}
   */
  aomRenderHooks;

  /**
   * 日志 Logger
   * @type {Logger}
   */
  #log;

  /**
   * @param {{
   *   width?: number,
   *   height?: number,
   *   rootPath?: string,
   *   persistenceAdapter?: PersistenceAdapter,
   *   aomRenderHooks?: AomRenderHooks,
   * }} [options={}] - 白板核心初始化选项
   */
  constructor(options = {}) {
    this.#log = new Logger("BoardCore", "INFO", logBus);
    this.width = options.width ?? 0;
    this.height = options.height ?? 0;
    this.rootPath = options.rootPath;
    this.undoTree = new UndoTree();
    this.chunkLoaded = new Map();
    this.objectLoaded = new Map();
    this.chunkLoadEventBus = new EventBus();
    this.rootChunkLoader = new ChunkLoader({
      resolveChunkById: (chunkId) =>
        this.#getOrCreateChunkLoadedState(chunkId).chunk,
      unloadChunk: (chunk) => this.#unloadRootChunk(chunk),
      eventBus: this.chunkLoadEventBus,
      requesterId: "board-core-root",
    });

    this.persistenceAdapter =
      options.persistenceAdapter ?? createDefaultPersistenceAdapter();
    this.aomRenderHooks =
      options.aomRenderHooks ?? createDefaultAomRenderHooks();
    this.activeObjectManager = new ActiveObjectManager(this, {
      renderHooks: this.aomRenderHooks,
    });

    this.#bindChunkLoadEvents();
  }

  /**
   * 是否使用内存模式
   * @returns {boolean}
   */
  memoryMode() {
    return !isValidBoardRootPath(this.rootPath);
  }

  /**
   * 当前白板核心是否启用文件系统持久化
   * @returns {boolean}
   */
  isPersistent() {
    return !this.memoryMode();
  }

  /**
   * 解析当前白板核心可用的持久化根路径
   * @param {string} [boardRootPath=this.rootPath] - 候选根路径
   * @returns {string | undefined}
   */
  resolvePersistenceRootPath(boardRootPath = this.rootPath) {
    if (!this.isPersistent()) return undefined;
    return isValidBoardRootPath(boardRootPath) ? boardRootPath : undefined;
  }

  /**
   * 创建绑定到当前 BoardCore 的 ChunkLoader
   * @param {number | string} requesterId - 请求方 id
   * @returns {ChunkLoader}
   */
  createChunkLoader(requesterId) {
    return new ChunkLoader({
      resolveChunkById: (chunkId) => this.rootChunkLoader.getChunkById(chunkId),
      eventBus: this.chunkLoadEventBus,
      requesterId,
    });
  }

  /**
   * 获取根区块加载器
   * @returns {ChunkLoader}
   */
  getChunkLoader() {
    return this.rootChunkLoader;
  }

  /**
   * 按 id 获取区块实例
   * @param {number} chunkId - 区块 id
   * @returns {Chunk | undefined}
   */
  getChunkById(chunkId) {
    return this.rootChunkLoader.getChunkById(chunkId);
  }

  /**
   * 按坐标获取区块实例
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {Chunk | undefined}
   */
  getChunkByCoordinate(x, y) {
    return this.rootChunkLoader.getChunkByCoordinate(x, y);
  }

  /**
   * 获取区块的左右邻区块
   * @param {Chunk} chunk - 当前区块
   * @param {"right" | "left" | "up" | "down"} direction - 方向
   * @returns {Chunk | undefined}
   */
  getNeighborChunk(chunk, direction) {
    if (!chunk) return undefined;

    const delta = {
      right: { x: 1, y: 0 },
      left: { x: -1, y: 0 },
      up: { x: 0, y: 1 },
      down: { x: 0, y: -1 },
    }[direction];
    if (!delta) return undefined;

    return this.getChunkByCoordinate(chunk.x + delta.x, chunk.y + delta.y);
  }

  /**
   * 获取某区块当前总持有数
   * @param {number} chunkId - 区块 id
   * @returns {number}
   */
  getChunkLoadCount(chunkId) {
    const chunkState = this.chunkLoaded.get(chunkId);
    if (!chunkState) return 0;
    return chunkState.tempLoadedCount + chunkState.fullLoadedCount;
  }

  /**
   * 获取对象加载状态条目
   * @param {number} objectId - 对象 id
   * @returns {BoardObjectLoadedState | undefined}
   */
  getObjectEntry(objectId) {
    return this.objectLoaded.get(objectId);
  }

  /**
   * 获取对象实例
   * @param {number} objectId - 对象 id
   * @returns {BasicObject | undefined}
   */
  getObjectById(objectId) {
    return this.objectLoaded.get(objectId)?.obj;
  }

  /**
   * 获取对象当前完整加载计数
   * @param {number} objectId - 对象 id
   * @returns {number}
   */
  getObjectLoadCount(objectId) {
    return this.objectLoaded.get(objectId)?.loadedCount ?? 0;
  }

  /**
   * 注册对象实例到白板级对象表
   * @param {BasicObject} obj - 对象实例
   * @param {{ coveredChunkIds?: Iterable<number> }} [options={}] - 额外选项
   * @returns {BasicObject}
   */
  registerObjectInstance(obj, options = {}) {
    if (!(obj instanceof BasicObject)) {
      throw new TypeError("Invalid object instance.");
    }

    const coveredChunkIds = new Set(options.coveredChunkIds ?? []);
    const loadedCount =
      coveredChunkIds.size > 0
        ? this.#countFullLoadReferences(coveredChunkIds)
        : this.getObjectLoadCount(obj.id);

    this.objectLoaded.set(obj.id, {
      obj,
      loadedCount,
    });

    return obj;
  }

  /**
   * 对象覆盖区块索引（对象 id → 覆盖的区块 id 集合）
   * 全 BoardCore 唯一的权威副本，不再按 ChunkObjectManager 重复存储
   * @type {Map<number, Set<number>>}
   * @private
   */
  #objectCoverChunks = new Map();

  /**
   * 写入对象覆盖区块索引
   * @param {number} objectId - 对象 id
   * @param {Iterable<number>} chunkIds - 覆盖的区块 id 集合
   * @returns {void}
   */
  setObjectCoverChunks(objectId, chunkIds) {
    this.#objectCoverChunks.set(objectId, new Set(chunkIds));
  }

  /**
   * 读取对象覆盖区块集合
   * @param {number} objectId - 对象 id
   * @returns {Set<number>|undefined}
   */
  getObjectCoverChunks(objectId) {
    return this.#objectCoverChunks.get(objectId);
  }

  /**
   * 删除对象覆盖区块索引
   * @param {number} objectId - 对象 id
   * @returns {void}
   */
  unsetObjectCoverChunks(objectId) {
    this.#objectCoverChunks.delete(objectId);
  }

  /**
   * 添加对象到白板核心
   * @param {BasicObject} obj - 要添加的对象
   */
  addObject(obj) {
    if (!(obj instanceof BasicObject)) {
      throw new TypeError("Invalid object instance.");
    }
    const chunkId = Chunk.worldToChunkId(obj.position, this.width, this.height);
    if (chunkId == null) {
      throw new Error("Cannot resolve chunk for object position.");
    }
    const chunk = this.getChunkById(chunkId);
    if (!chunk) {
      this.#log.throttledWarn(
        "chunk-not-exist",
        `Chunk ${chunkId} does not exist.`,
      );
      throw new Error("Chunk not exist.");
    }

    chunk.addObject(obj);

    let coveredChunkIds = new Set([chunk.id]);
    if (chunk.objectManager && this.width > 0 && this.height > 0) {
      coveredChunkIds = chunk.objectManager.syncObjectCoverChunksForObject(
        obj,
        this.width,
        this.height,
      );
    }

    this.registerObjectInstance(obj, { coveredChunkIds });
  }

  /**
   * 按区块加载对象实例到白板级对象表
   * @param {Chunk | number} chunkOrId - 区块实例或区块 id
   * @param {string} [boardRootPath=this.rootPath] - 白板根路径
   * @returns {Promise<Map<number, BasicObject>>}
   */
  async loadChunkObjectEntries(chunkOrId, boardRootPath = this.rootPath) {
    const chunk =
      typeof chunkOrId === "number" ? this.getChunkById(chunkOrId) : chunkOrId;
    const loadedObjects = new Map();
    const effectiveBoardRootPath =
      this.resolvePersistenceRootPath(boardRootPath);

    if (!chunk || !effectiveBoardRootPath) return loadedObjects;

    const objectIds = [
      ...(chunk.objectManager?.staticGraph?.getNodes?.() ?? []),
    ];
    const objectDataList =
      objectIds.length > 0
        ? await this.persistenceAdapter.loadObjects(objectIds)
        : [];

    for (const objectData of objectDataList ?? []) {
      const obj = deserialize(objectData);
      const coveredChunkIds = this.getObjectCoverChunks(obj.id);
      this.registerObjectInstance(obj, { coveredChunkIds });
      loadedObjects.set(obj.id, obj);
    }

    return loadedObjects;
  }

  /**
   * 保存指定区块归属的对象
   * @param {Chunk | number} chunkOrId - 区块实例或区块 id
   * @param {string} [boardRootPath=this.rootPath] - 白板根路径
   * @returns {Promise<void>}
   */
  async saveChunkObjectEntries(chunkOrId, boardRootPath = this.rootPath) {
    const chunk =
      typeof chunkOrId === "number" ? this.getChunkById(chunkOrId) : chunkOrId;
    const effectiveBoardRootPath =
      this.resolvePersistenceRootPath(boardRootPath);
    if (!chunk || !effectiveBoardRootPath) return;

    const objectIds = [
      ...(chunk.objectManager?.staticGraph?.getNodes?.() ?? []),
    ];
    const serializedObjects = objectIds
      .map((id) => this.getObjectById(id))
      .filter(Boolean)
      .map((obj) =>
        obj && typeof obj.serialize === "function" ? obj.serialize() : obj,
      );

    if (serializedObjects.length > 0) {
      await this.persistenceAdapter.saveObjects(serializedObjects);
    }
  }

  /**
   * 根据区块当前加载状态同步其对象 loadedCount，并清理失活对象
   * @param {Chunk | number} chunkOrId - 区块实例或区块 id
   * @returns {Promise<void>}
   */
  async syncChunkObjectEntries(chunkOrId) {
    const chunk =
      typeof chunkOrId === "number" ? this.getChunkById(chunkOrId) : chunkOrId;
    if (!chunk?.objectManager?.staticGraph) return;

    for (const objectId of chunk.objectManager.staticGraph.getNodes()) {
      await this.#syncObjectEntryForChunk(chunk, objectId);
    }
  }

  /**
   * 卸载指定区块相关的对象实例
   * @param {Chunk | number} chunkOrId - 区块实例或区块 id
   */
  unloadChunkObjectEntries(chunkOrId) {
    const chunk =
      typeof chunkOrId === "number" ? this.getChunkById(chunkOrId) : chunkOrId;
    if (!chunk?.objectManager?.staticGraph) return;

    for (const objectId of chunk.objectManager.staticGraph.getNodes()) {
      const entry = this.objectLoaded.get(objectId);
      if (!entry) continue;

      const coveredChunkIds = this.getObjectCoverChunks(objectId);
      const effectiveChunkIds =
        coveredChunkIds.size > 0 ? coveredChunkIds : new Set([chunk.id]);
      entry.loadedCount = this.#countFullLoadReferences(effectiveChunkIds);

      if (
        entry.loadedCount <= 0 &&
        !this.activeObjectManager?.activeObjectIndex?.has?.(objectId)
      ) {
        this.objectLoaded.delete(objectId);
      }
    }
  }

  /**
   * 绑定区块加载相关事件
   * @private
   */
  #bindChunkLoadEvents() {
    this.chunkLoadEventBus.on(
      CHUNK_LOAD_EVENTS.REQUEST_LOAD,
      ({ requesterId, chunk, strategy, alreadyBuffered }) => {
        this.#loadChunk(chunk, strategy, alreadyBuffered, requesterId).catch(
          (error) => {
            this.#log.error("Failed to load chunk:", error);
          },
        );
      },
    );

    this.chunkLoadEventBus.on(
      CHUNK_LOAD_EVENTS.REQUEST_UNLOAD,
      ({ requesterId, chunk }) => {
        this.#unloadChunk(chunk, requesterId).catch((error) => {
          this.#log.error("Failed to unload chunk:", error);
        });
      },
    );
  }

  /**
   * 加载区块
   * @param {Chunk} chunk - 要加载的区块
   * @param {"temp" | "full"} strategy - 加载策略
   * @param {boolean} alreadyBuffered - 是否已经在缓冲区中
   * @param {number | string} requesterId - 请求方 id
   * @returns {Promise<boolean>}
   * @private
   */
  async #loadChunk(chunk, strategy, alreadyBuffered, requesterId) {
    if (!chunk || requesterId === undefined) return false;

    const { previousStrategy, effectiveStrategy } =
      this.#registerChunkLoadRequest(chunk.id, requesterId, strategy);

    const boardRootPath = this.resolvePersistenceRootPath();
    const shouldSyncChunkObjects =
      (chunk?.objectManager?.staticGraph?.getNodes?.()?.length ?? 0) > 0;

    if (effectiveStrategy === CHUNK_LOAD_STRATEGIES.FULL) {
      const changed = await chunk.loadFull(boardRootPath);
      if (
        previousStrategy !== CHUNK_LOAD_STRATEGIES.FULL &&
        shouldSyncChunkObjects
      ) {
        await this.syncChunkObjectEntries(chunk);
      }
      this.chunkLoadEventBus.emit(CHUNK_LOAD_EVENTS.LOAD_COMPLETE, {
        chunkId: chunk.id,
      });
      return changed;
    }

    if (chunk.isLoad && !chunk.isTempLoad) {
      this.chunkLoadEventBus.emit(CHUNK_LOAD_EVENTS.LOAD_COMPLETE, {
        chunkId: chunk.id,
      });
      return false;
    }

    const changed = await chunk.loadTemp(boardRootPath);
    this.chunkLoadEventBus.emit(CHUNK_LOAD_EVENTS.LOAD_COMPLETE, {
      chunkId: chunk.id,
    });
    return changed;
  }

  /**
   * 卸载区块
   * @param {Chunk} chunk - 要卸载的区块
   * @param {number | string} requesterId - 请求方 id
   * @returns {Promise<boolean>}
   * @private
   */
  async #unloadChunk(chunk, requesterId) {
    if (!chunk || requesterId === undefined) return false;

    if (!this.isPersistent()) {
      return false;
    }

    const removedStrategy = this.#unregisterChunkLoadRequest(
      chunk.id,
      requesterId,
    );
    if (!removedStrategy) return false;

    const shouldSyncChunkObjects =
      (chunk?.objectManager?.staticGraph?.getNodes?.()?.length ?? 0) > 0;

    if (
      removedStrategy === CHUNK_LOAD_STRATEGIES.FULL &&
      shouldSyncChunkObjects
    ) {
      await this.syncChunkObjectEntries(chunk);
    }

    const chunkState = this.chunkLoaded.get(chunk.id);
    const fullLoadedCount = chunkState?.fullLoadedCount ?? 0;
    const tempLoadedCount = chunkState?.tempLoadedCount ?? 0;

    if (fullLoadedCount > 0) {
      return false;
    }

    if (tempLoadedCount > 0) {
      if (!chunk.isLoad) return false;
      return chunk.isTempLoad ? false : chunk.downgradeToTemp();
    }

    if (!chunk.isLoad) return false;
    const unloaded = chunk.isTempLoad ? chunk.unloadTemp() : chunk.unload();
    this.unloadChunkObjectEntries(chunk);
    return unloaded;
  }

  /**
   * 卸载区块（强制）
   * @param {Chunk} chunk - 要卸载的区块
   * @returns {boolean}
   * @private
   */
  #unloadRootChunk(chunk) {
    if (!chunk) return false;
    if (!this.isPersistent()) return false;

    const chunkState = this.chunkLoaded.get(chunk.id);
    const fullLoadedCount = chunkState?.fullLoadedCount ?? 0;
    const tempLoadedCount = chunkState?.tempLoadedCount ?? 0;
    if (fullLoadedCount > 0 || tempLoadedCount > 0) {
      return false;
    }

    if (chunk.isLoad) {
      const unloaded = chunk.isTempLoad ? chunk.unloadTemp() : chunk.unload();
      if (unloaded === false) return false;
      this.unloadChunkObjectEntries(chunk);
    }

    this.chunkLoaded.delete(chunk.id);
    return true;
  }

  /**
   * 获取或创建区块加载状态
   * @param {number} chunkId - 区块 id
   * @returns {BoardChunkLoadedState}
   * @private
   */
  #getOrCreateChunkLoadedState(chunkId) {
    if (!this.chunkLoaded.has(chunkId)) {
      const chunk = Chunk.fromId(chunkId);
      chunk.board = this;
      this.chunkLoaded.set(chunkId, {
        chunk,
        tempLoadedCount: 0,
        fullLoadedCount: 0,
        loaderStrategy: new Map(),
      });
    }

    return this.chunkLoaded.get(chunkId);
  }

  /**
   * 记录某个区块加载器对某区块的加载持有关系
   * @param {number} chunkId - 区块 id
   * @param {number | string} requesterId - 请求方 id
   * @param {"temp" | "full"} strategy - 加载策略
   * @returns {{ previousStrategy: "temp" | "full" | undefined, effectiveStrategy: "temp" | "full" }}
   * @private
   */
  #registerChunkLoadRequest(chunkId, requesterId, strategy) {
    const chunkState = this.#getOrCreateChunkLoadedState(chunkId);
    const previousStrategy = chunkState.loaderStrategy.get(requesterId);
    const effectiveStrategy =
      previousStrategy === CHUNK_LOAD_STRATEGIES.FULL
        ? CHUNK_LOAD_STRATEGIES.FULL
        : strategy;

    if (previousStrategy === effectiveStrategy) {
      return { previousStrategy, effectiveStrategy };
    }

    if (previousStrategy === CHUNK_LOAD_STRATEGIES.TEMP) {
      chunkState.tempLoadedCount = Math.max(0, chunkState.tempLoadedCount - 1);
    } else if (previousStrategy === CHUNK_LOAD_STRATEGIES.FULL) {
      chunkState.fullLoadedCount = Math.max(0, chunkState.fullLoadedCount - 1);
    }

    chunkState.loaderStrategy.set(requesterId, effectiveStrategy);
    if (effectiveStrategy === CHUNK_LOAD_STRATEGIES.FULL) {
      chunkState.fullLoadedCount += 1;
    } else {
      chunkState.tempLoadedCount += 1;
    }

    return { previousStrategy, effectiveStrategy };
  }

  /**
   * 取消某个区域加载器对某区块的加载持有关系
   * @param {number} chunkId - 区块 id
   * @param {number | string} requesterId - 请求方 id
   * @returns {"temp" | "full" | undefined}
   * @private
   */
  #unregisterChunkLoadRequest(chunkId, requesterId) {
    const chunkState = this.chunkLoaded.get(chunkId);
    if (!chunkState) return undefined;

    const previousStrategy = chunkState.loaderStrategy.get(requesterId);
    if (!previousStrategy) return undefined;

    chunkState.loaderStrategy.delete(requesterId);

    if (previousStrategy === CHUNK_LOAD_STRATEGIES.FULL) {
      chunkState.fullLoadedCount = Math.max(0, chunkState.fullLoadedCount - 1);
    } else {
      chunkState.tempLoadedCount = Math.max(0, chunkState.tempLoadedCount - 1);
    }

    return previousStrategy;
  }

  /**
   * 计算指定覆盖区块集合的完整加载引用数
   * @param {Iterable<number>} chunkIds - 覆盖区块集合
   * @returns {number}
   * @private
   */
  #countFullLoadReferences(chunkIds) {
    let loadedCount = 0;

    for (const chunkId of chunkIds) {
      const chunkState = this.chunkLoaded.get(chunkId);
      loadedCount += chunkState?.fullLoadedCount ?? 0;
    }

    return loadedCount;
  }

  /**
   * 确保对象实例已加载到白板级注册表
   * @param {number} objectId - 对象 id
   * @param {Iterable<number>} candidateChunkIds - 候选区块 id
   * @returns {Promise<BasicObject | undefined>}
   * @private
   */
  async #ensureObjectInstanceLoaded(objectId, candidateChunkIds) {
    const existingObject = this.getObjectById(objectId);
    if (existingObject instanceof BasicObject) {
      return existingObject;
    }

    for (const chunkId of candidateChunkIds) {
      await this.loadChunkObjectEntries(chunkId);
      const hydratedObject = this.getObjectById(objectId);
      if (hydratedObject instanceof BasicObject) {
        return hydratedObject;
      }
    }

    return undefined;
  }

  /**
   * 同步区块内单个对象的 loadedCount 与实例状态
   * @param {Chunk} chunk - 区块实例
   * @param {number} objectId - 对象 id
   * @returns {Promise<void>}
   * @private
   */
  async #syncObjectEntryForChunk(chunk, objectId) {
    const coveredChunkIds = this.getObjectCoverChunks(objectId);
    const effectiveChunkIds =
      coveredChunkIds.size > 0 ? coveredChunkIds : new Set([chunk.id]);
    const loadedCount = this.#countFullLoadReferences(effectiveChunkIds);

    if (loadedCount > 0) {
      await this.#ensureObjectInstanceLoaded(objectId, effectiveChunkIds);
    }

    const entry = this.objectLoaded.get(objectId);
    if (!entry) return;

    entry.loadedCount = loadedCount;

    if (
      entry.loadedCount <= 0 &&
      !this.activeObjectManager?.activeObjectIndex?.has?.(objectId)
    ) {
      this.objectLoaded.delete(objectId);
    }
  }
}

/**
 * 判断根路径字符串是否有效
 * @param {string} boardRootPath - 候选路径
 * @returns {boolean}
 */
function isValidBoardRootPath(boardRootPath) {
  return typeof boardRootPath === "string" && boardRootPath.trim() !== "";
}

export { BoardCore };
