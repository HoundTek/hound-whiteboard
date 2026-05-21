/**
 * 白板组件
 * @description
 * Board 类是白板在面向对象设计中的抽象核心，负责管理区块、对象、历史等信息，
 * 并提供相关初级接口供工具和设备调用。一个 Board 实例对应一个白板管辖。
 * @module board
 * @author Zhou Chenyu
 */

import { BasicObject } from "../objects/basic-obj.js";
import { CounterPool } from "../utils/counter-pool.js";
import { DirectedGraph } from "../utils/directed-graph.js";
import { EventBus } from "../utils/event-bus.js";
import { UndoTree } from "../hit/undo-tree-core.js";
import { ActiveObjectManager } from "./active-object-manager.js";
import { Monitor } from "./monitor.js";
import {
  ChunkLoader,
  CHUNK_LOAD_MANAGER_EVENTS,
  CHUNK_LOAD_STRATEGIES,
} from "./chunk-loader.js";
import { Chunk } from "./chunk.js";
import { boardFileOperateBridge } from "../bridges/file-operate-bridge-renderer.js";

/**
 * @typedef {Object} BoardChunkLoadedState
 * @property {Chunk} chunk - 当前区块实例
 * @property {number} tempLoadedCount - 临时加载计数
 * @property {number} fullLoadedCount - 完整加载计数
 * @property {Map<number | string, "temp" | "full">} loaderStrategy - 各 ChunkLoader 当前持有策略
 */

/**
 * Board 运行时节点配置事件载荷。
 * @typedef {Object} BoardConfigureEventPayload
 * @property {string} to - 目标设备树节点绝对路径，必须包含 monitorId
 * @property {import("../devices/devices-tree.js").DevicesTreeNodeConfig} options - 要更新到节点上的配置片段；`defaultPath` 传 `null` 或空串表示清空，`processor`/`rewritePacket` 传 `null` 表示清空
 */

/**
 * 白板类
 * @description 一个白板实例就对应了一个白板管辖。
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
    * @type {Map<number, BoardChunkLoadedState>}
   */
    chunkLoaded;

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
   * @type {string}
   */
  rootPath;

  /**
   * 区块 id 池
   * @type {CounterPool}
   */
  chunkCounterPool;

  /**
   * 对象 id 池
   * @type {CounterPool}
   */
  objectCounterPool;

  /**
   * 区块加载事件总线
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
   * @type {EventBus}
   */
  signalsEventBus;

  constructor() {
    this.undoTree = new UndoTree();
    this.chunkLoaded = new Map();
    this.chunkCounterPool = new CounterPool();
    this.objectCounterPool = new CounterPool();
    this.chunkLoadEventBus = new EventBus();
    this.monitors = new Map();
    this.signalsEventBus = new EventBus();
    this.activeObjectManager = new ActiveObjectManager(this);
    this.#bindChunkLoadEvents();
    this.#bindSignalsEventBus();
  }

  /**
   * 创建绑定到当前 Board 的区块加载器
   * @param {number} [limit = 0] - 缓冲区上限，为 0 则不限制
   * @param {number | string} [requesterId] - 请求方 id
   * @returns {ChunkLoader}
   */
  createChunkLoader(limit = 0, requesterId) {
    return new ChunkLoader(
      limit,
      this.chunkLoadEventBus,
      requesterId,
      (chunk, direction) => this.getNeighborChunk(chunk, direction),
    );
  }

  /**
   * 申请新的对象 id
   * @returns {number}
   */
  allocateObjectId() {
    return this.objectCounterPool.generate();
  }

  /**
   * 按 id 获取区块实例，不存在时惰性创建
   * @param {number} chunkId - 区块 id
   * @returns {Chunk | undefined}
   */
  getChunkById(chunkId) {
    const chunkState = this.#getOrCreateChunkLoadedState(chunkId);
    const chunk = chunkState.chunk;

    this.#syncChunkNeighborRefs(chunk);
    return chunk;
  }

  /**
   * 按坐标获取区块实例，不存在时惰性创建
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {Chunk | undefined}
   */
  getChunkByCoordinate(x, y) {
    const chunkId = Chunk.coordinateToId(x, y);
    return this.getChunkById(chunkId);
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
   * 同步区块的四向邻区块引用
   * @param {Chunk} chunk - 区块实例
   * @private
   */
  #syncChunkNeighborRefs(chunk) {
    if (!chunk) return;

    const directions = [
      ["right", 1, 0],
      ["left", -1, 0],
      ["up", 0, 1],
      ["down", 0, -1],
    ];

    for (const [direction, deltaX, deltaY] of directions) {
      const neighborId = Chunk.coordinateToId(chunk.x + deltaX, chunk.y + deltaY);

      const neighbor = this.chunkLoaded.get(neighborId)?.chunk;
      if (!neighbor) continue;
      Chunk.connectTwoChunk(chunk, neighbor, direction);
    }
  }

  /**
   * 获取或创建区块加载状态。
   * @param {number} chunkId - 区块 id
   * @returns {BoardChunkLoadedState}
   * @private
   */
  #getOrCreateChunkLoadedState(chunkId) {
    if (!this.chunkLoaded.has(chunkId)) {
      this.chunkLoaded.set(chunkId, {
        chunk: Chunk.fromId(chunkId),
        tempLoadedCount: 0,
        fullLoadedCount: 0,
        loaderStrategy: new Map(),
      });
    }

    return this.chunkLoaded.get(chunkId);
  }

  /**
   * 创建绑定到当前 Board 的 Monitor
   * @param {HTMLElement} rootElement - Monitor 的根元素
   * @param {{ width: number, height: number }} options - Monitor 尺寸选项
   * @param {string} monitorId - Monitor id
   * @returns {Monitor}
   */
  createMonitor(rootElement, { width, height }, monitorId) {
    const monitorCanvas = document.createElement("canvas");
    rootElement.appendChild(monitorCanvas);
    const monitor = new Monitor(
      monitorCanvas,
      this,
      {
        width: width ?? this.chunkWidth,
        height: height ?? this.chunkHeight,
      },
      monitorId,
    );
    // [todo] 监听 Monitor 的视口变化事件以更新 Board 的 origin 和 zoom
    this.monitors.set(monitorId, monitor);
    return monitor;
  }

  /**
   * 添加对象到指定区块
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

    if (chunk.objectManager && this.width > 0 && this.height > 0) {
      chunk.objectManager.syncObjectCoverChunksForObject(
        obj,
        this.width,
        this.height,
      );
    }
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
        monitor.devicesTree.dispatch({ to, signals });
      }
    });

    // mount 事件负责挂载工具到设备树
    this.signalsEventBus.on("mount", ({ to, tool }) => {
      const monitorId = to?.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return false;
      return monitor.devicesTree.mountTool(to, tool, {
        board: this,
        monitor,
      });
    });

    // umount 事件负责从设备树卸载工具
    this.signalsEventBus.on("umount", ({ to }) => {
      const monitorId = to?.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return false;
      return monitor.devicesTree.unmountTool(to);
    });

    // configure 事件负责更新设备树节点配置
    this.signalsEventBus.on("configure", ({ to, options }) => {
      const monitorId = to?.split("/")[1];
      const monitor = this.monitors.get(monitorId);
      if (!monitor) return false;
      return monitor.devicesTree.configureNode(to, options ?? {});
    });
  }

  /**
   * 绑定区块加载相关事件
   * @private
   */
  #bindChunkLoadEvents() {
    this.chunkLoadEventBus.on(
      CHUNK_LOAD_MANAGER_EVENTS.REQUEST_LOAD,
      ({ requesterId, chunk, strategy, alreadyBuffered }) => {
        this.#loadChunk(chunk, strategy, alreadyBuffered, requesterId).catch(
          (error) => {
            console.error("Failed to load chunk via IPC bridge:", error);
          },
        );
      },
    );

    this.chunkLoadEventBus.on(
      CHUNK_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD,
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
   * @param {number | string} requesterId - 发起加载请求的 PLM id
   * @returns {Promise<boolean>} 是否成功加载
   * @private
   */
  async #loadChunk(chunk, strategy, alreadyBuffered, requesterId) {
    if (!chunk || requesterId === undefined) return false;

    const effectiveStrategy = this.#registerChunkLoadRequest(
      chunk.id,
      requesterId,
      strategy,
    );

    const boardRootPath = this.rootPath;

    if (effectiveStrategy === CHUNK_LOAD_STRATEGIES.FULL) {
      const changed = await chunk.loadFull(boardRootPath);
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
   * @param {number | string} requesterId - 发起卸载请求的 PLM id
   * @returns {Promise<boolean>} 是否成功卸载
   * @private
   */
  async #unloadChunk(chunk, requesterId) {
    if (!chunk || requesterId === undefined) return false;

    const removedStrategy = this.#unregisterChunkLoadRequest(
      chunk.id,
      requesterId,
    );
    if (!removedStrategy) return false;

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
    return chunk.isTempLoad ? chunk.unloadTemp() : chunk.unload();
  }

  /**
   * 持久化区块连接信息
   * @private
   */
  async #persistChunkConnection() {
    if (!this.rootPath) return;
    await boardFileOperateBridge.writeChunkConnection(this.rootPath, {
      count: this.chunkCounterPool.counter,
    });
  }

  /**
   * 记录某个区块klfakkdk对某区块的加载持有关系
   * @param {number} chunkId - 区块 id
   * @param {number | string} requesterId - 区块加载器 id
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
      return effectiveStrategy;
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
    return effectiveStrategy;
  }

  /**
   * 取消某个 PLM 对某区块的加载持有关系
   * @param {number} chunkId - 区块 id
   * @param {number | string} requesterId - PLM id
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
   * @private
   */
  #getChunkLoadCount(chunkId) {
    const chunkState = this.chunkLoaded.get(chunkId);
    if (!chunkState) return 0;
    return chunkState.tempLoadedCount + chunkState.fullLoadedCount;
  }
}

const boardMeta = {
  type: "board",
  version: "0.1.0",
};

export { Board };
