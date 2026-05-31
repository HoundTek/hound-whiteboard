/**
 * @file 白板组件
 * @description
 * Board 类是白板在面向对象设计中的抽象核心，负责维护白板级区块实例所有权、
 * 对象实例注册表、区块加载引用计数、活动对象管理器以及 monitor/设备事件入口。
 * 一个 Board 实例对应一个白板管辖。
 * @module core/components/board
 * @author Zhou Chenyu
 */

import { BasicObject } from "../objects/basic-obj.js";
import { deserialize } from "../objects/object-deserializer.js";
import { CounterPool } from "../utils/counter-pool.js";
import { DirectedGraph } from "../utils/directed-graph.js";
import { EventBus } from "../utils/event-bus.js";
import { UndoTree } from "../hit/undo-tree-core.js";
import { DevicesTree } from "../devices/devices-tree.js";
import { ActiveObjectManager } from "./active-object-manager.js";
import { Monitor } from "./monitor.js";
import {
  ChunkBlockLoader,
  CHUNK_LOAD_STRATEGIES,
} from "./chunk-block-loader.js";
import { CHUNK_LOAD_EVENTS, ChunkLoader } from "./chunk-loader.js";
import { Chunk } from "./chunk.js";
import { boardFileOperateBridge } from "../bridges/file-operate-bridge-renderer.js";

function isValidBoardRootPath(boardRootPath) {
  return typeof boardRootPath === "string" && boardRootPath.trim() !== "";
}

/**
 * @typedef {Object} BoardChunkLoadedState
 * @property {Chunk} chunk - 当前区块实例
 * @property {number} tempLoadedCount - 临时加载计数
 * @property {number} fullLoadedCount - 完整加载计数
 * @property {Map<number | string, "temp" | "full">} loaderStrategy - 各 ChunkBlockLoader 当前持有策略
 */

/**
 * @typedef {Object} BoardObjectLoadedState
 * @property {BasicObject} obj - 对象实例
 * @property {number} loadedCount - 当前对象被完整加载持有的总计数
 */

/**
 * Board 运行时节点配置事件载荷。
 * @typedef {Object} BoardConfigureEventPayload
 * @property {string} to - 目标设备树节点绝对路径，必须包含 monitorId
 * @property {import("../devices/devices-tree.js").DevicesTreeNodeConfig} options - 要更新到节点上的配置片段；`defaultChild` 传 `null` 或空串表示清空，`handler` 传 `null` 表示清空
 */

/**
 * 白板类
 * @description 一个白板实例就对应了一个白板管辖，并统一协调区块加载、对象实例生命周期与 monitor 绑定。
 * @class
 * @author Zhou Chenyu
 */
class Board {
  /**
   * 时间回溯树
   * @type {UndoTree}
   */
  undoTree;

  /**
   * 活动对象管理器
   * @type {ActiveObjectManager}
   * @description 管理当前活动对象（如选中对象、正在操作的对象等）
   */
  activeObjectManager;

  /**
   * 当前已知区块的统一加载状态
   * @description 区块 id -> 加载状态条目，记录根 `ChunkLoader` 与各 `ChunkBlockLoader` 的持有引用。
   * @type {Map<number, BoardChunkLoadedState>}
   */
  chunkLoaded;

  /**
   * 白板级对象实例注册表
   * @description 对象 id -> `{ obj, loadedCount }`；`loadedCount` 为该对象覆盖区块上的完整加载持有总数。
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
   * 白板的文件路径
   * @description 持久化根路径；为空时当前白板工作在纯内存模式。
   * @type {string | undefined}
   */
  rootPath;

  /**
   * 对象 id 池
   * @type {CounterPool}
   */
  objectCounterPool;

  /**
   * 区块加载事件总线
   * @description 协调根 `ChunkLoader`、`ChunkBlockLoader` 与 `Board` 私有加载逻辑。
   * @type {EventBus}
   */
  chunkLoadEventBus;

  /**
   * 显示器列表
   * @type {Map<string, Monitor>}
   */
  monitors;

  /**
   * 信道事件总线
   * @description 把设备输入、工具挂载与节点配置请求分发到对应 monitor。
   * @type {EventBus}
   */
  signalsEventBus;

  /**
   * 白板级唯一设备树。
   * @type {DevicesTree}
   */
  devicesTree;

  /**
   * 根区块加载器。
   * @description
   * `Board` 通过根 `ChunkLoader` 持有白板级区块实例所有权。
   * `Board.getChunkById(...)`、`Board.getChunkByCoordinate(...)` 与 `Board.getChunkLoader()` 都委托到该实例。
   * @type {ChunkLoader}
   */
  rootChunkLoader;

  /**
   * @param {{
   *   rootPath?: string,
   * }} [options={}] - 白板初始化选项；传入有效 `rootPath` 时启用文件系统持久化，否则退化为内存模式
   */
  constructor(options = {}) {
    this.undoTree = new UndoTree();
    this.chunkLoaded = new Map();
    this.objectLoaded = new Map();
    this.objectCounterPool = new CounterPool();
    this.chunkLoadEventBus = new EventBus();
    this.monitors = new Map();
    this.signalsEventBus = new EventBus();
    this.devicesTree = new DevicesTree({
      maxDispatchDepth: 32,
    });
    this.rootChunkLoader = new ChunkLoader({
      resolveChunkById: (chunkId) =>
        this.#getOrCreateChunkLoadedState(chunkId).chunk,
      unloadChunk: (chunk) => this.#unloadRootChunk(chunk),
      eventBus: this.chunkLoadEventBus,
      requesterId: "board-root",
    });
    this.activeObjectManager = new ActiveObjectManager(this);
    this.rootPath = isValidBoardRootPath(options.rootPath)
      ? options.rootPath
      : undefined;
    this.#bindChunkLoadEvents();
    this.#bindSignalsEventBus();
  }

  /**
   * 是否使用内存模式。
   * @description 当前实现仅通过 `rootPath` 是否可用来推导持久化模式。
   * @returns {boolean}
   */
  memoryMode() {
    return !isValidBoardRootPath(this.rootPath);
  }

  /**
   * 当前白板是否启用文件系统持久化。
   * @returns {boolean}
   */
  isPersistent() {
    return !this.memoryMode();
  }

  /**
   * 解析当前白板可用的持久化根路径。
   * @description 内存模式下统一返回 `undefined`，用于让对象/区块文件读写逻辑短路。
   * @param {string} [boardRootPath = this.rootPath] - 候选根路径
   * @returns {string | undefined}
   */
  resolvePersistenceRootPath(boardRootPath = this.rootPath) {
    if (!this.isPersistent()) {
      return undefined;
    }

    return isValidBoardRootPath(boardRootPath) ? boardRootPath : undefined;
  }

  /**
   * 创建绑定到当前 Board 的区块加载器
   * @description
   * 这里创建的是矩形缓冲区包装器 `ChunkBlockLoader`。
   * 它内部会再持有一个独立的 `ChunkLoader`，用于保存本缓冲区视角下的区块对象集合；
   * 区块实例本身仍由 `Board.rootChunkLoader` 统一解析。
   * @param {number} [limit = 0] - 缓冲区上限，为 0 则不限制
   * @param {number | string} [requesterId] - 请求方 id
   * @returns {ChunkBlockLoader}
   */
  createChunkBlockLoader(limit = 0, requesterId) {
    return new ChunkBlockLoader(
      limit,
      this.chunkLoadEventBus,
      requesterId,
      (chunk, direction) => this.getNeighborChunk(chunk, direction),
      new ChunkLoader({
        resolveChunkById: (chunkId) =>
          this.rootChunkLoader.getChunkById(chunkId),
        eventBus: this.chunkLoadEventBus,
        requesterId,
      }),
    );
  }

  /**
   * 获取白板根区块加载器。
   * @returns {ChunkLoader}
   */
  getChunkLoader() {
    return this.rootChunkLoader;
  }

  /**
   * 申请新的对象 id
   * @returns {number}
   */
  allocateObjectId() {
    return this.objectCounterPool.generate();
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
   * @description 若提供 `coveredChunkIds`，会立即按这些区块上的完整加载引用数更新 `loadedCount`。
   * @param {BasicObject} obj - 对象实例
   * @param {{ coveredChunkIds?: Iterable<number> }} [options = {}] - 额外选项
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
   * 获取对象覆盖区块集合
   * @description 先从候选区块出发，再按这些区块记录的覆盖索引扩展搜索范围。
   * @param {number} objectId - 对象 id
   * @param {Iterable<number>} [candidateChunkIds = []] - 候选区块 id
   * @returns {Set<number>}
   */
  getObjectCoverChunks(objectId, candidateChunkIds = []) {
    const chunkIdsToSearch = new Set(candidateChunkIds);

    for (const chunkId of candidateChunkIds) {
      const chunk = this.getChunkById(chunkId);
      const coveredChunkIds =
        chunk?.objectManager?.getObjectCoverChunks?.(objectId);
      for (const coveredChunkId of coveredChunkIds ?? []) {
        chunkIdsToSearch.add(coveredChunkId);
      }
    }

    for (const chunkId of chunkIdsToSearch) {
      const chunk = this.getChunkById(chunkId);
      const coveredChunkIds =
        chunk?.objectManager?.getObjectCoverChunks?.(objectId);
      if (coveredChunkIds?.size > 0) {
        return new Set(coveredChunkIds);
      }
    }

    return new Set();
  }

  /**
   * 按区块加载对象实例到白板级对象表
   * @description 仅在文件系统持久化模式下生效；渲染侧通过 IPC 读取对象 JSON，再注册到 `objectLoaded`。
   * @param {Chunk | number} chunkOrId - 区块实例或区块 id
   * @param {string} [boardRootPath = this.rootPath] - 白板根路径
   * @returns {Promise<Map<number, BasicObject>>}
   */
  async loadChunkObjectEntries(chunkOrId, boardRootPath = this.rootPath) {
    const chunk =
      typeof chunkOrId === "number" ? this.getChunkById(chunkOrId) : chunkOrId;
    const loadedObjects = new Map();
    const effectiveBoardRootPath =
      this.resolvePersistenceRootPath(boardRootPath);

    if (!chunk || !effectiveBoardRootPath) return loadedObjects;

    const objectDataList = await boardFileOperateBridge.loadChunkObjects(
      effectiveBoardRootPath,
      chunk.id,
    );

    for (const objectData of objectDataList ?? []) {
      const obj = deserialize(objectData);
      const coveredChunkIds = this.getObjectCoverChunks(obj.id, [chunk.id]);
      this.registerObjectInstance(obj, { coveredChunkIds });
      loadedObjects.set(obj.id, obj);
    }

    return loadedObjects;
  }

  /**
   * 保存指定区块归属的对象
   * @description 仅保存 `ownerChunkId === chunk.id` 的对象实例。
   * @param {Chunk | number} chunkOrId - 区块实例或区块 id
   * @param {string} [boardRootPath = this.rootPath] - 白板根路径
   * @returns {Promise<void>}
   */
  async saveChunkObjectEntries(chunkOrId, boardRootPath = this.rootPath) {
    const chunk =
      typeof chunkOrId === "number" ? this.getChunkById(chunkOrId) : chunkOrId;
    const effectiveBoardRootPath =
      this.resolvePersistenceRootPath(boardRootPath);
    if (!chunk || !effectiveBoardRootPath) return;

    const serializedObjects = Array.from(this.objectLoaded.values())
      .map((entry) => entry.obj)
      .filter((obj) => obj?.ownerChunkId === chunk.id)
      .map((obj) =>
        obj && typeof obj.serialize === "function" ? obj.serialize() : obj,
      );

    await boardFileOperateBridge.saveChunkObjects(
      effectiveBoardRootPath,
      chunk.id,
      serializedObjects,
    );
  }

  /**
   * 根据区块当前加载状态同步其对象 loadedCount，并清理失活对象
   * @description 当对象覆盖区块上的完整加载引用降为 0，且对象不在活动层时，会从 `objectLoaded` 回收。
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
   * @description 该过程不会直接删除活动对象，只会刷新 `loadedCount` 并回收失活对象。
   * @param {Chunk | number} chunkOrId - 区块实例或区块 id
   * @returns {void}
   */
  unloadChunkObjectEntries(chunkOrId) {
    const chunk =
      typeof chunkOrId === "number" ? this.getChunkById(chunkOrId) : chunkOrId;
    if (!chunk?.objectManager?.staticGraph) return;

    for (const objectId of chunk.objectManager.staticGraph.getNodes()) {
      const entry = this.objectLoaded.get(objectId);
      if (!entry) continue;

      const coveredChunkIds = this.getObjectCoverChunks(objectId, [chunk.id]);
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
   * 按 id 获取区块实例，不存在时惰性创建
   * @description 当前实现委托给 `Board` 持有的根 `ChunkLoader`。
   * @param {number} chunkId - 区块 id
   * @returns {Chunk | undefined}
   */
  getChunkById(chunkId) {
    return this.rootChunkLoader.getChunkById(chunkId);
  }

  /**
   * 按坐标获取区块实例，不存在时惰性创建
   * @description 当前实现委托给 `Board` 持有的根 `ChunkLoader`。
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
   * 获取或创建区块加载状态。
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
   * 创建绑定到当前 Board 的 Monitor
   * @description 会同时创建 base/live/ui 三层 canvas，并把 monitor 注册到 `Board.monitors`。
   * @param {HTMLElement} rootElement - Monitor 的根元素
   * @param {{ width: number, height: number }} options - Monitor 尺寸选项
   * @param {string} monitorId - Monitor id
   * @returns {Monitor}
   */
  createMonitor(rootElement, { width, height }, monitorId) {
    const monitorWidth = width ?? this.chunkWidth;
    const monitorHeight = height ?? this.chunkHeight;
    const monitorRoot = document.createElement("div");
    const baseCanvas = document.createElement("canvas");
    const liveCanvas = document.createElement("canvas");
    const uiCanvas = document.createElement("canvas");

    monitorRoot.id = `monitor-root-${monitorId}`;
    monitorRoot.className = "monitor-root";
    monitorRoot.style.width = `${monitorWidth}px`;
    monitorRoot.style.height = `${monitorHeight}px`;

    baseCanvas.id = `monitor-base-canvas-${monitorId}`;
    baseCanvas.className = "monitor-layer monitor-layer-base";
    liveCanvas.id = `monitor-canvas-${monitorId}`;
    liveCanvas.className = "monitor-layer monitor-layer-live";
    uiCanvas.id = `monitor-ui-canvas-${monitorId}`;
    uiCanvas.className = "monitor-layer monitor-layer-ui";

    monitorRoot.appendChild(baseCanvas);
    monitorRoot.appendChild(liveCanvas);
    monitorRoot.appendChild(uiCanvas);
    rootElement.appendChild(monitorRoot);

    const monitor = new Monitor(
      {
        rootElement: monitorRoot,
        baseCanvas,
        liveCanvas,
        uiCanvas,
      },
      this,
      {
        width: monitorWidth,
        height: monitorHeight,
      },
      monitorId,
    );
    this.monitors.set(monitorId, monitor);
    return monitor;
  }

  /**
   * 添加对象到指定区块
   * @description 会同步对象覆盖区块索引，并把对象实例注册到白板级对象表。
   * @param {BasicObject} obj - 要添加的对象
   * @param {number} [chunkId = obj.ownerChunkId] - 要添加到的归属区块 id
   */
  addObject(obj, chunkId = obj?.ownerChunkId) {
    if (!(obj instanceof BasicObject)) {
      throw new TypeError("Invalid object instance.");
    }
    const chunk = this.getChunkById(chunkId);
    if (!chunk) {
      console.warn(`Chunk ${chunkId} does not exist.`);
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
   * 绑定信道相关事件
   * @private
   */
  #bindSignalsEventBus() {
    // input 事件负责将信号送往对应节点
    this.signalsEventBus.on("input", ({ to, signals }) => {
      const monitorId = to.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (monitor) {
        this.devicesTree.dispatch({ to, signals }, { board: this, monitor });
      }
    });

    // mount 事件负责挂载工具到设备树
    this.signalsEventBus.on("mount", ({ to, tool }) => {
      const monitorId = to?.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return false;
      return this.devicesTree.mountTool(to, tool, {
        board: this,
        monitor,
      });
    });

    // umount 事件负责从设备树卸载工具
    this.signalsEventBus.on("umount", ({ to }) => {
      const monitorId = to?.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return false;
      return this.devicesTree.unmountTool(to, {
        board: this,
        monitor,
      });
    });

    // configure 事件负责更新设备树节点配置
    this.signalsEventBus.on("configure", ({ to, options }) => {
      const monitorId = to?.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return false;
      return this.devicesTree.configureNode(to, options ?? {});
    });
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
            console.error("Failed to load chunk via IPC bridge:", error);
          },
        );
      },
    );

    this.chunkLoadEventBus.on(
      CHUNK_LOAD_EVENTS.REQUEST_UNLOAD,
      ({ requesterId, chunk }) => {
        this.#unloadChunk(chunk, requesterId).catch((error) => {
          console.error("Failed to unload chunk:", error);
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
   * @returns {Promise<boolean>} 是否成功加载
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
      return changed;
    }

    if (chunk.isLoad && !chunk.isTempLoad) {
      return false;
    }

    return chunk.loadTemp(boardRootPath);
  }

  /**
   * 卸载区块
   * @param {Chunk} chunk - 要卸载的区块
   * @param {number | string} requesterId - 请求方 id
   * @returns {Promise<boolean>} 是否成功卸载
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
   * @returns {boolean} 是否成功卸载
   * @private
   */
  #unloadRootChunk(chunk) {
    if (!chunk) return false;

    if (!this.isPersistent()) {
      return false;
    }

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
   * 记录某个区块加载器对某区块的加载持有关系
   * @param {number} chunkId - 区块 id
   * @param {number | string} requesterId - 请求方 id
   * @param {"temp" | "full"} strategy - 加载策略
   * @returns {"temp" | "full"} 生效后的策略
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
      return {
        previousStrategy,
        effectiveStrategy,
      };
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
    return {
      previousStrategy,
      effectiveStrategy,
    };
  }

  /**
   * 取消某个区域加载器对某区块的加载持有关系
   * @param {number} chunkId - 区块 id
   * @param {number | string} requesterId - 请求方 id
   * @returns {"temp" | "full" | undefined} 被移除的策略
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
   * 确保对象实例已加载到 Board 级注册表
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
    const coveredChunkIds = this.getObjectCoverChunks(objectId, [chunk.id]);
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

const boardMeta = {
  type: "board",
  version: "0.1.0",
};

export { Board };
