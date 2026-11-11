/**
 * @file 白板核心
 * @description
 * BoardCore 是白板在 Worker 中的纯数据实现，承载对象注册、区块加载、AOM、持久化协调等职责。
 * 不依赖 DevicesDAG、DOM、signalsEventBus。
 * @module kernel/board/board-core
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { BasicObject } from "../objects/basic-obj.js";
import { deserialize } from "../objects/object-deserializer.js";
import { EventBus } from "../utils/event-bus.js";
import { IncrementalIdPool } from "../utils/incremental-id-pool.js";
import { Logger } from "../../utils/log/logger.js";
import { logBus } from "../../utils/log/log-bus.js";
import { ActiveObjectManager } from "./active-object-manager.js";
import { createDefaultAomRenderHooks } from "./aom-render-hooks.js";
import { OperationLog } from "../hit/operation-log.js";
import { UndoTree } from "../hit/undo-tree-core.js";
import { HitCommitter } from "../hit/hit-committer.js";
import {
  CHUNK_LOAD_EVENTS,
  CHUNK_LOAD_STRATEGIES,
  ChunkLoader,
} from "../chunk/chunk-loader.js";
import { Chunk } from "../chunk/chunk.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { DirectedGraph } from "../utils/directed-graph.js";
import { createDefaultPersistenceAdapter } from "./persistence-adapter.js";

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
 * @property {(objectInstances: BasicObject[]) => void} requestActiveRender
 * @property {(chunks: import("../chunk/chunk.js").Chunk[]) => void} requestStaticRender
 * @property {(objectInstances: BasicObject[], fallbackChunks: import("../chunk/chunk.js").Chunk[], previousWorldRects: Map<number, import("../range/index.js").RectangleRange>) => void} requestStaticRenderForObjects
 * @property {(objectInstances: BasicObject[]) => void} flushViewportForObjects
 */

/**
 * @typedef {import("./persistence-adapter.js").PersistenceAdapter} PersistenceAdapter
 */

/**
 * 默认区块边长（世界单位）
 * @description
 * 区块是存储与载入的粒度单位；世界是无限的，白板本身没有尺寸。
 * 取值依据实测：1024 时 10% 缩放的加载窗口约 285 个区块、元数据读取约 17ms；
 * 单区块在常见笔画密度下约 650 个对象，进入新区域载入约 12ms。
 * 更小的块会让深缩放时区块数暴涨，更大的块会让单次载入出现 50ms 以上卡顿。
 * @type {number}
 */
const DEFAULT_CHUNK_SIZE = 1024;

/**
 * 归一化区块边长
 * @param {number} [size] - 原始边长
 * @returns {number} 可用的区块边长
 */
function normalizeChunkSize(size) {
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_CHUNK_SIZE;
}

/**
 * 白板核心类
 * @description
 * BoardCore 是白板在 Worker 中的纯数据/逻辑实现。
 * - 承载对象注册表（objectLoaded）、区块加载状态（chunkLoaded）、IncrementalIdPool、AOM
 * - 通过注入式 persistenceAdapter 完成文件读写（契约与默认实现见 kernel/board/persistence-adapter）
 * - 通过注入式 renderHooks 消除 AOM 对 viewport/renderer 的直接依赖
 * - 不持有 DevicesDAG、signalsEventBus、DOM 引用
 * @class
 * @author Zhou Chenyu
 */
class BoardCore {
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
   * @type {Map<string, BoardObjectLoadedState>}
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
   *   内存模式使用 createDefaultPersistenceAdapter()，文件模式注入 io 包的 createPersistenceAdapter()。
   * @type {PersistenceAdapter}
   */
  persistenceAdapter;

  /**
   * AOM 渲染钩子
   * @description 注入式渲染钩子，替代 AOM 对 viewport.renderer 的直接访问。
   * @type {AomRenderHooks}
   */
  aomRenderHooks;

  /**
   * 操作日志（hit 数据池）
   * @type {OperationLog}
   */
  operationLog;

  /**
   * 时间回溯树
   * @type {UndoTree}
   */
  undoTree;

  /**
   * hit 提交器（分子操作的 commit 边界单点）
   * @type {HitCommitter}
   */
  hitCommitter;

  /**
   * 已删除对象的回收站（板根 trash/ 的内存态）
   * @description
   * 对象 id -> { data（删除时刻的全量序列化）, chunks（各区块层位边集） }；
   * 撤销删除时恢复对象与层位的依据，落盘随持久化落地。
   * @type {Map<string, Object>}
   */
  trash = new Map();

  /**
   * Core 侧对象 id 分配器表
   * @description 键为来源标识，值为该来源的 Core id 分配器；首次使用时 lazy 创建。
   * @type {Map<string, IncrementalIdPool>}
   */
  #idAllocatorTable = new Map();

  /**
   * UI 侧对象 id 池计数表
   * @description 键为来源标识，值为该来源已分配的最大计数；随板元数据持久化，重开续种。
   * @type {Map<string, number>}
   */
  #objectIdCounters = new Map();

  /**
   * 区块卸载开关（false 时根加载器不卸载区块，对象全量驻留）
   * @type {boolean}
   * @private
   */
  #chunkUnloadEnabled = true;

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
   *   source?: string,
   *   hitRecords?: Object[],
   *   lastTime?: number,
   *   now?: () => number,
   *   coreIdCounters?: Object<string, number>,
   *   objectIdCounters?: Object<string, number>,
   *
   * @description
   * `width` / `height` 是区块边长（决定盘上区块划分），不是板尺寸。
   * }} [options={}] - 白板核心初始化选项
   */
  constructor(options = {}) {
    this.#log = new Logger("BoardCore", "INFO", logBus);
    this.width = normalizeChunkSize(options.width);
    this.height = normalizeChunkSize(options.height);
    this.rootPath = options.rootPath;
    this.chunkLoaded = new Map();
    this.objectLoaded = new Map();
    this.chunkLoadEventBus = new EventBus();
    /**
     * AOM 活动事件总线（ephemeral）
     * @description 本地 choose/unchoose/commit 手势事件即时广播通道；不经日志，同步宿主订阅后转发中继。
     * @type {EventBus}
     */
    this.activityEventBus = new EventBus();
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
    this.#chunkUnloadEnabled = options.chunkUnload !== false;
    this.activeObjectManager = new ActiveObjectManager(this, {
      renderHooks: this.aomRenderHooks,
    });

    this.operationLog = options.hitRecords
      ? OperationLog.fromJSON(options.hitRecords)
      : new OperationLog();
    this.undoTree = new UndoTree(this.operationLog);
    if (options.hitRecords) {
      this.undoTree.rebuild();
    }
    this.hitCommitter = new HitCommitter({
      source: options.source ?? "core",
      log: this.operationLog,
      tree: this.undoTree,
      now: options.now,
      lastTime: options.lastTime,
    });
    for (const [source, counter] of Object.entries(
      options.coreIdCounters ?? {},
    )) {
      this.#idAllocatorTable.set(
        source,
        new IncrementalIdPool(source ? `${source}/core` : "core", counter),
      );
    }
    for (const [source, counter] of Object.entries(
      options.objectIdCounters ?? {},
    )) {
      if (Number.isInteger(counter)) {
        this.#objectIdCounters.set(source, counter);
      }
    }

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
   * 申请 Core 侧对象 id
   * @description
   * 供 Core 内部创建对象（如数据擦除分裂）时使用。
   * 每个来源标识对应独立的分配器，首次使用时 lazy 创建，
   * 生成的 id 形如 `"{source}/core/{n}"`（空来源为 `"core/{n}"`）。
   * @param {string} [source=""] - 来源标识
   * @returns {string} 携带来源命名空间的字符串 id
   */
  allocateObjectId(source = "") {
    let allocator = this.#idAllocatorTable.get(source);
    if (!allocator) {
      allocator = new IncrementalIdPool(source ? `${source}/core` : "core");
      this.#idAllocatorTable.set(source, allocator);
    }
    return allocator.allocate();
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
   * FullLoad 指定区块并等待全部加载完成
   * @description 先注册监听再触发加载（加载可能同步完成，事件先于注册会错过）。
   * 不能用 once：多区块并发加载时首个 LOAD_COMPLETE 会消耗全部 once 监听，
   * 仅匹配者 resolve、其余监听已被移除而永久挂起（如圆对象跨区块场景）。
   * @param {Chunk[]} chunks - 待加载的区块实例
   * @param {number | string} requesterId - loader 请求方 id
   * @returns {Promise<ChunkLoader>} 完成加载的 loader，由调用方负责销毁
   */
  async loadChunksAndWaitComplete(chunks, requesterId) {
    const loader = this.createChunkLoader(requesterId);
    await Promise.all(
      chunks.map((chunk) => {
        loader.trackChunk(chunk);
        const promise = new Promise((resolve) => {
          const handler = (payload) => {
            if (payload.chunkId === chunk.id) {
              this.chunkLoadEventBus.off(
                CHUNK_LOAD_EVENTS.LOAD_COMPLETE,
                handler,
              );
              resolve();
            }
          };
          this.chunkLoadEventBus.on(CHUNK_LOAD_EVENTS.LOAD_COMPLETE, handler);
        });
        loader.emitLoadRequest(chunk, { strategy: "full" });
        return promise;
      }),
    );
    return loader;
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
   * @param {string} objectId - 对象 id
   * @returns {BoardObjectLoadedState | undefined}
   */
  getObjectEntry(objectId) {
    return this.objectLoaded.get(objectId);
  }

  /**
   * 获取对象实例
   * @param {string} objectId - 对象 id
   * @returns {BasicObject | undefined}
   */
  getObjectById(objectId) {
    return this.objectLoaded.get(objectId)?.obj;
  }

  /**
   * 获取全部活动对象实例
   * @returns {BasicObject[]} 活动对象数组（不含 trash 中的已删对象）
   */
  getAllObjects() {
    return [...this.objectLoaded.values()].map((entry) => entry.obj);
  }

  /**
   * 本端来源标识（操作记录 source 与对象 id 前缀；写端身份）
   * @type {string}
   */
  get source() {
    return this.hitCommitter.source;
  }

  /**
   * 恢复会话状态（对象、trash 与区块层叠图）
   * @param {Object} session - 会话数据
   * @param {Array<{chunkId: number, tierGraph: any[], objectCoverIndex: any[]}>} [session.chunkMetadataList] - 区块元数据列表
   * @param {Object[]} [session.objects] - 活动对象序列化数据数组
   * @param {Array<{data: Object, chunks: Array}>} [session.trash] - trash 条目数组
   * @returns {void}
   *
   * @description
   * 打开既有板时调用：层叠图与覆盖索引先回填（决定对象注册时的加载计数），
   * 随后注册活动对象实例，最后恢复 trash 条目（含层位边，供跨会话撤销删除使用）。
   */
  restoreSession({ chunkMetadataList = [], objects = [], trash = [] } = {}) {
    for (const { chunkId, tierGraph, objectCoverIndex } of chunkMetadataList) {
      const chunk = this.getChunkById(chunkId);
      if (!chunk) continue;
      if (!chunk.objectManager) {
        chunk.objectManager = new ChunkObjectManager(chunk.id, this);
      }
      chunk.objectManager.staticGraph = DirectedGraph.parse(tierGraph);
      chunk.objectManager.loadObjectCoverChunksFromData(objectCoverIndex);
      // 层叠图与覆盖索引已从盘上恢复，区块即完整加载态
      chunk.isLoad = true;
      chunk.isTempLoad = false;
    }
    for (const data of objects) {
      let obj = null;
      try {
        obj = deserialize(data);
      } catch (error) {
        // 坏对象文件降级：跳过并告警，不阻断会话恢复
        console.warn(
          `[board-core] 跳过不可反序列化的持久化对象（${String(data?.id)}）：${error?.message ?? error}`,
        );
      }
      if (obj) {
        this.registerObjectInstance(obj);
      }
    }
    for (const entry of trash) {
      if (!entry?.data?.id) continue;
      this.trash.set(entry.data.id, {
        data: entry.data,
        chunks: entry.chunks ?? [],
      });
    }
  }

  /**
   * 收集随板元数据持久化的会话状态
   * @returns {{boardConfig: {width: number, height: number}, coreIdCounters: Object<string, number>, objectIdCounters: Object<string, number>}} 会话计数器与板配置
   */
  collectSessionMeta() {
    const coreIdCounters = {};
    for (const [source, allocator] of this.#idAllocatorTable) {
      coreIdCounters[source] = allocator.counter;
    }
    return {
      // 区块边长决定盘上区块划分，重开必须与原值一致
      boardConfig: { width: this.width, height: this.height },
      coreIdCounters,
      objectIdCounters: Object.fromEntries(this.#objectIdCounters),
    };
  }

  /**
   * 上报 UI 侧对象 id 池计数
   * @param {string} source - 来源标识
   * @param {number} counter - 已分配的最大计数
   * @returns {boolean} 是否接受（单调取大，回拨拒绝）
   */
  reportObjectIdCounter(source, counter) {
    if (
      typeof source !== "string" ||
      !Number.isInteger(counter) ||
      counter < 0
    ) {
      return false;
    }
    const current = this.#objectIdCounters.get(source) ?? 0;
    if (counter < current) return false;
    this.#objectIdCounters.set(source, counter);
    return true;
  }

  /**
   * 读取 UI 侧对象 id 池计数表
   * @returns {Object<string, number>} 各来源已分配的最大计数
   */
  getObjectIdCounters() {
    return Object.fromEntries(this.#objectIdCounters);
  }

  /**
   * 获取对象当前完整加载计数
   * @param {string} objectId - 对象 id
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
    // 实例回到内存：解除驻留驱逐标记
    this.#evictedObjectIds.delete(obj.id);

    return obj;
  }

  /**
   * 对象覆盖区块索引（对象 id → 覆盖的区块 id 集合）
   * 全 BoardCore 唯一的权威副本，不再按 ChunkObjectManager 重复存储
   * @type {Map<string, Set<number>>}
   * @private
   */
  #objectCoverChunks = new Map();

  /**
   * 写入对象覆盖区块索引
   * @param {string} objectId - 对象 id
   * @param {Iterable<number>} chunkIds - 覆盖的区块 id 集合
   * @returns {void}
   */
  setObjectCoverChunks(objectId, chunkIds) {
    this.#objectCoverChunks.set(objectId, new Set(chunkIds));
  }

  /**
   * 读取对象覆盖区块集合
   * @param {string} objectId - 对象 id
   * @returns {Set<number>|undefined}
   */
  getObjectCoverChunks(objectId) {
    return this.#objectCoverChunks.get(objectId);
  }

  /**
   * 删除对象覆盖区块索引
   * @param {string} objectId - 对象 id
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
    if (chunk.objectManager) {
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
      let obj = null;
      try {
        obj = deserialize(objectData);
      } catch (error) {
        // 坏对象文件降级：跳过并告警，不阻断区块加载
        console.warn(
          `[board-core] 跳过不可反序列化的区块对象（${String(objectData?.id)}）：${error?.message ?? error}`,
        );
        continue;
      }
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
      ...(chunk.objectManager?.staticGraph.getNodes() ?? []),
    ];
    const serializedObjects = objectIds
      .map((id) => this.getObjectById(id))
      .filter(Boolean)
      .map((obj) => obj.serialize());

    if (serializedObjects.length > 0) {
      await this.persistenceAdapter.saveObjects(serializedObjects);
    }
  }

  /**
   * 驻留驱逐标记：经卸载路径（chunkUnload）离场的对象 id
   * @description 「合法缺失」的唯一形态：静态图对象只有经卸载路径离场才不算驻留缺失；
   * 效果缺失（add 效果未放全）不在此列，仍属全量驻留口径下的可比对分歧。注册实例时解除。
   * @type {Set<string>}
   */
  #evictedObjectIds = new Set();

  /**
   * 对象是否处于驻留驱逐状态（经卸载路径合法离场）
   * @param {string} objectId - 对象 id
   * @returns {boolean} 是否被驱逐
   */
  isObjectEvicted(objectId) {
    return this.#evictedObjectIds.has(objectId);
  }

  /**
   * 是否全量驻留（无经卸载路径的合法缺失）
   * @description 内容校验和（对象数据口径）只在全量驻留端之间可比；
   * 部分驻留端（chunkUnload 驱逐了对象实例）跳过内容比对，避免「误报 → 全量物化 → 卸载 → 再误报」循环。
   * @returns {boolean} 是否全量驻留
   */
  isFullResidency() {
    return this.#evictedObjectIds.size === 0;
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

      // chunkUnload 关闭时（CLI / daemon 常驻持板）对象不从内存移除，查询面口径保持全量
      if (
        this.#chunkUnloadEnabled !== false &&
        entry.loadedCount <= 0 &&
        !this.activeObjectManager?.isActive?.(objectId) &&
        !this.activeObjectManager?.isRemoteActive?.(objectId)
      ) {
        this.objectLoaded.delete(objectId);
        // 经卸载路径离场：登记驻留驱逐（「合法缺失」，内容校验和比对因此豁免）
        this.#evictedObjectIds.add(objectId);
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

    const shouldSyncChunkObjects =
      (chunk.objectManager?.staticGraph.getNodes().length ?? 0) > 0;

    if (effectiveStrategy === CHUNK_LOAD_STRATEGIES.FULL) {
      const changed = await chunk.loadFull();
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

    const changed = await chunk.loadTemp();
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
      (chunk.objectManager?.staticGraph.getNodes().length ?? 0) > 0;

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

    // chunkUnload 关闭时（CLI / daemon 常驻持板）区块不从内存卸载，仅维护引用计数
    if (this.#chunkUnloadEnabled === false) {
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

    // chunkUnload 关闭时（CLI / daemon 常驻持板）区块不从内存卸载
    if (this.#chunkUnloadEnabled === false) {
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
   * @param {string} objectId - 对象 id
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
   * @param {string} objectId - 对象 id
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

    // chunkUnload 关闭时（CLI / daemon 常驻持板）对象不从内存移除
    if (
      this.#chunkUnloadEnabled !== false &&
      entry.loadedCount <= 0 &&
      !this.activeObjectManager?.isActive?.(objectId) &&
      !this.activeObjectManager?.isRemoteActive?.(objectId)
    ) {
      this.objectLoaded.delete(objectId);
      // 经卸载路径离场：登记驻留驱逐（「合法缺失」，内容校验和比对因此豁免）
      this.#evictedObjectIds.add(objectId);
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

export { BoardCore, DEFAULT_CHUNK_SIZE };
