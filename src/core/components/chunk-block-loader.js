/**
 * @file 区块加载器
 * @module core/components/chunk-block-loader
 * @author Zhou Chenyu
 */

import { Chunk } from "./chunk.js";
import { CHUNK_LOAD_EVENTS, ChunkLoader } from "./chunk-loader.js";
import { EventBus } from "../utils/event-bus.js";

const CHUNK_LOAD_STRATEGIES = Object.freeze({
  TEMP: "temp",
  FULL: "full",
});

let chunkBlockLoaderIdCounter = 0;

/**
 * 区块加载器
 * @class
 * @description
 * `ChunkBlockLoader` 是 `ChunkLoader` 的包装器，用于表达连续矩形范围的区块缓冲区。
 * 它内部仍通过 `ChunkLoader` 持有区块对象，自己只负责维护当前区块、矩形边界，以及缓冲区扩缩与移动意图。
 * 需要注意的是 ChunkBlockLoader 无法直接加载区块，
 * 它只能通过内部 ChunkLoader 间接发出加载区块的请求，
 * 由 Board 来调用 Chunk 的加载方法。
 * @author Zhou Chenyu
 */
class ChunkBlockLoader {
  /**
   * 被包装的通用区块加载器。
   * @description 实际的区块对象持有、按 id/坐标访问与卸载都委托给该 `ChunkLoader`。
   * @type {ChunkLoader}
   */
  chunkLoader;

  /**
   * 在该管理器中已加载的区块
   * @description 以区块 id 为键保存当前缓冲区中的区块实例。
   * @type {Map<number, Chunk>}
   */
  get chunksLoaded() {
    return this.chunkLoader.chunksLoaded;
  }

  /**
   * 当前区块引用
   * @type {Chunk | undefined}
   */
  chunkNow;

  /**
   * 可以加载的区块数上限，为 0 则不限制
   * @type {number}
   */
  chunksLoadedLimit = 0;

  /**
   * 邻区块解析器
   * @type {(chunk: Chunk, direction: "right" | "left" | "up" | "down") => Chunk | undefined}
   */
  resolveNeighbor;

  /**
   * 当前缓冲区边界
   * @type {{ minX: number, maxX: number, minY: number, maxY: number } | undefined}
   */
  bufferBounds;

  /**
   * 区块原始邻接快照。
   * @description
   * `ChunkLoader` 纳管区块时会刷新当前持有集合内部的邻接引用，
   * 这里保留区块进入缓冲区前的邻接快照，供默认邻区块解析回退使用。
   * @type {WeakMap<Chunk, { right?: Chunk, left?: Chunk, up?: Chunk, down?: Chunk }>}
   */
  neighborSnapshot;

  /**
   * @param {number} [limit = 0] - 可以加载的区块数上限
   * @param {EventBus} [eventBus] - 用于配置内部 `ChunkLoader` 的区块加载事件总线
   * @param {number | string} [requesterId] - 用于配置内部 `ChunkLoader` 的请求方 id
   * @param {(chunk: Chunk, direction: "right" | "left" | "up" | "down") => Chunk | undefined} [resolveNeighbor] - 邻区块解析器
   * @param {ChunkLoader} [chunkLoader] - 被包装的通用区块加载器
   */
  constructor(
    limit = 0,
    eventBus = new EventBus(),
    requesterId = ++chunkBlockLoaderIdCounter,
    resolveNeighbor = (chunk, direction) => {
      const neighborField = {
        right: "rightChunk",
        left: "leftChunk",
        up: "upChunk",
        down: "downChunk",
      }[direction];
      return neighborField ? chunk?.[neighborField] : undefined;
    },
    chunkLoader = new ChunkLoader(),
  ) {
    this.chunksLoadedLimit = limit;
    this.chunkLoader = chunkLoader.configureEventContext({
      eventBus,
      requesterId,
    });
    this.resolveNeighbor = resolveNeighbor;
    this.bufferBounds = undefined;
    this.neighborSnapshot = new WeakMap();
  }

  moveCurrentRight() {
    return this.#moveCurrent("right");
  }

  forceMoveCurrentRightTempLoad() {
    return this.#forceMoveCurrent("right", CHUNK_LOAD_STRATEGIES.TEMP);
  }

  forceMoveCurrentRightFullLoad() {
    return this.#forceMoveCurrent("right", CHUNK_LOAD_STRATEGIES.FULL);
  }

  moveCurrentLeft() {
    return this.#moveCurrent("left");
  }

  forceMoveCurrentLeftTempLoad() {
    return this.#forceMoveCurrent("left", CHUNK_LOAD_STRATEGIES.TEMP);
  }

  forceMoveCurrentLeftFullLoad() {
    return this.#forceMoveCurrent("left", CHUNK_LOAD_STRATEGIES.FULL);
  }

  moveCurrentUp() {
    return this.#moveCurrent("up");
  }

  forceMoveCurrentUpTempLoad() {
    return this.#forceMoveCurrent("up", CHUNK_LOAD_STRATEGIES.TEMP);
  }

  forceMoveCurrentUpFullLoad() {
    return this.#forceMoveCurrent("up", CHUNK_LOAD_STRATEGIES.FULL);
  }

  moveCurrentDown() {
    return this.#moveCurrent("down");
  }

  forceMoveCurrentDownTempLoad() {
    return this.#forceMoveCurrent("down", CHUNK_LOAD_STRATEGIES.TEMP);
  }

  forceMoveCurrentDownFullLoad() {
    return this.#forceMoveCurrent("down", CHUNK_LOAD_STRATEGIES.FULL);
  }

  expandBufferRightTempLoad() {
    return this.#expandBuffer("right", CHUNK_LOAD_STRATEGIES.TEMP);
  }

  expandBufferRightFullLoad() {
    return this.#expandBuffer("right", CHUNK_LOAD_STRATEGIES.FULL);
  }

  expandBufferLeftTempLoad() {
    return this.#expandBuffer("left", CHUNK_LOAD_STRATEGIES.TEMP);
  }

  expandBufferLeftFullLoad() {
    return this.#expandBuffer("left", CHUNK_LOAD_STRATEGIES.FULL);
  }

  expandBufferUpTempLoad() {
    return this.#expandBuffer("up", CHUNK_LOAD_STRATEGIES.TEMP);
  }

  expandBufferUpFullLoad() {
    return this.#expandBuffer("up", CHUNK_LOAD_STRATEGIES.FULL);
  }

  expandBufferDownTempLoad() {
    return this.#expandBuffer("down", CHUNK_LOAD_STRATEGIES.TEMP);
  }

  expandBufferDownFullLoad() {
    return this.#expandBuffer("down", CHUNK_LOAD_STRATEGIES.FULL);
  }

  shrinkBufferRight() {
    return this.#shrinkBuffer("right");
  }

  shrinkBufferLeft() {
    return this.#shrinkBuffer("left");
  }

  shrinkBufferUp() {
    return this.#shrinkBuffer("up");
  }

  shrinkBufferDown() {
    return this.#shrinkBuffer("down");
  }

  /**
   * 以指定区块初始化缓冲区
   * @param {Chunk} chunk - 区块实例
   * @returns {Chunk | undefined} 初始化后的当前区块实例
   */
  initChunk(chunk) {
    this.#resetBufferState();
    this.chunkNow = chunk;
    if (chunk) this.#insertChunk(chunk);
    this.#emitBufferUpdated("reset", "none");
    return this.chunkNow;
  }

  /**
   * 重置缓冲区
   */
  resetBuffer() {
    const chunks = this.getLoadedChunks();
    for (const chunk of chunks) {
      this.chunkLoader.emitUnloadRequest(chunk, { source: "reset" });
    }
    this.#resetBufferState();
    this.#emitBufferUpdated("reset", "none");
  }

  /**
   * 清空当前缓冲区状态，不发出加载或卸载事件。
   * @private
   */
  #resetBufferState() {
    this.chunkLoader.reset();
    this.bufferBounds = undefined;
    this.chunkNow = undefined;
    this.neighborSnapshot = new WeakMap();
  }

  /**
   * 当前区块缓冲区快照
   * @returns {Chunk[]}
   */
  getLoadedChunks() {
    return this.chunkLoader.getLoadedChunks().sort((left, right) => {
      if (left.y !== right.y) return right.y - left.y;
      return left.x - right.x;
    });
  }

  /**
   * 当前区块缓冲区区块数
   * @description 该值来自内部 `ChunkLoader` 的持有区块数，而不是单独维护的计数器。
   * @returns {number}
   */
  get chunksLoadedCount() {
    return this.chunksLoaded.size;
  }

  /**
   * 当前区块网格边界快照
   * @returns {{ minX: number, maxX: number, minY: number, maxY: number } | undefined}
   */
  getBufferBounds() {
    if (!this.bufferBounds) return undefined;
    return { ...this.bufferBounds };
  }

  /**
   * 以指定区块 id 初始化缓冲区。
   * @param {number} chunkId - 区块 id
   * @returns {Chunk | undefined}
   */
  initChunkById(chunkId) {
    if (!Number.isInteger(chunkId) || chunkId <= 0) return undefined;
    return this.initChunk(this.chunkLoader.getChunkById(chunkId));
  }

  /**
   * 以指定坐标区块初始化缓冲区。
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {Chunk | undefined}
   */
  initChunkByCoordinate(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
    return this.initChunk(this.chunkLoader.getChunkByCoordinate(x, y));
  }

  /**
   * 以指定坐标邻域初始化缓冲区。
   * @param {number} x - 中心区块 x
   * @param {number} y - 中心区块 y
   * @param {number} [radius = 1] - 邻域半径
   * @returns {Chunk[]}
   */
  initChunksAroundCoordinate(x, y, radius = 1) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return [];

    this.#resetBufferState();
    const chunks = [];

    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const chunk = this.chunkLoader.getChunkByCoordinate(
          x + offsetX,
          y + offsetY,
        );
        this.#insertChunk(chunk);
        if (offsetX === 0 && offsetY === 0) {
          this.chunkNow = chunk;
        }
        chunks.push(chunk);
      }
    }

    this.#emitBufferUpdated("reset", "none");
    return chunks;
  }

  /**
   * 尝试移动当前区块在缓冲区内的位置
   * @param {"right" | "left" | "up" | "down"} direction - 移动方向
   * @returns {boolean} 是否成功移动
   * @private
   */
  #moveCurrent(direction) {
    if (!this.chunkNow) return false;
    const targetChunk = this.#getNeighbor(this.chunkNow, direction);
    if (!targetChunk || !this.#hasChunk(targetChunk)) {
      return false;
    }

    this.chunkNow = targetChunk;
    this.#emitBufferUpdated("move", direction);
    return true;
  }

  /**
   * 强制移动当前区块在缓冲区内的位置
   * @param {"right" | "left" | "up" | "down"} direction - 移动方向
   * @param {"temp" | "full"} strategy - 加载策略
   * @returns {boolean} 是否成功移动
   * @private
   */
  #forceMoveCurrent(direction, strategy) {
    if (!this.chunkNow) return false;
    const targetChunk = this.#getNeighbor(this.chunkNow, direction);
    if (!targetChunk) return false;

    if (!this.#hasChunk(targetChunk)) {
      this.chunkNow = targetChunk;
      this.#appendChunksToBuffer(
        [targetChunk],
        direction,
        strategy,
        "force-move",
      );
    } else {
      if (strategy === CHUNK_LOAD_STRATEGIES.FULL) {
        this.chunkLoader.emitLoadRequest(targetChunk, {
          strategy,
          direction,
          source: "force-move",
          alreadyBuffered: true,
        });
      }
      this.chunkNow = targetChunk;
    }

    this.#emitBufferUpdated("move", direction);
    return true;
  }

  /**
   * 扩展缓冲区
   * @param {"right" | "left" | "up" | "down"} direction - 扩展方向
   * @param {"temp" | "full"} strategy - 加载策略
   * @returns {boolean} 是否成功扩展
   * @private
   */
  #expandBuffer(direction, strategy) {
    if (this.chunksLoadedCount === 0) return false;

    const edgeChunks = this.#getEdgeChunks(direction);
    const targetChunks = [];
    const seen = new Set();
    for (const edgeChunk of edgeChunks) {
      const targetChunk = this.#getNeighbor(edgeChunk, direction);
      if (!targetChunk || this.#hasChunk(targetChunk)) continue;

      const key = targetChunk.id;
      if (seen.has(key)) continue;
      seen.add(key);
      targetChunks.push(targetChunk);
    }

    if (targetChunks.length === 0) return false;

    this.#appendChunksToBuffer(
      targetChunks,
      direction,
      strategy,
      "expand-buffer",
    );
    this.#emitBufferUpdated("expand", direction);
    return true;
  }

  /**
   * 收缩缓冲区边界
   * @param {"right" | "left" | "up" | "down"} direction - 收缩方向
   * @returns {boolean} 是否成功收缩
   * @private
   */
  #shrinkBuffer(direction) {
    if (this.chunksLoadedCount === 0) return false;

    const boundaryChunks = this.#getEdgeChunks(direction);
    if (
      boundaryChunks.length === 0 ||
      boundaryChunks.some((chunk) => chunk === this.chunkNow)
    ) {
      return false;
    }

    for (const chunk of boundaryChunks) {
      this.#removeChunk(chunk);
      this.chunkLoader.emitUnloadRequest(chunk, { source: "shrink-buffer" });
    }
    this.#emitBufferUpdated("shrink", direction);
    return true;
  }

  /**
   * 把区块加载到缓冲区中
   * @param {Chunk[]} chunks - 要加载的区块
   * @param {"right" | "left" | "up" | "down"} direction - 加载方向
   * @param {"temp" | "full"} strategy - 加载策略
   * @param {"force-move" | "expand-buffer"} source - 加载来源
   * @private
   */
  #appendChunksToBuffer(chunks, direction, strategy, source) {
    for (const chunk of chunks) {
      this.chunkLoader.emitLoadRequest(chunk, {
        strategy,
        direction,
        source,
        alreadyBuffered: false,
      });
      this.#insertChunk(chunk);
    }

    this.#trimBuffer(direction);
  }

  /**
   * 修剪缓冲区
   * @param {"right" | "left" | "up" | "down"} direction - 修剪方向
   * @private
   */
  #trimBuffer(direction) {
    if (this.chunksLoadedLimit === 0) return;

    const oppositeDirection = {
      right: "left",
      left: "right",
      up: "down",
      down: "up",
    }[direction];

    while (this.chunksLoadedCount > this.chunksLoadedLimit) {
      let chunksToRemove = this.#getEdgeChunks(oppositeDirection).filter(
        (chunk) => chunk !== this.chunkNow,
      );

      if (chunksToRemove.length === 0) {
        chunksToRemove = this.#getEdgeChunks(direction).filter(
          (chunk) => chunk !== this.chunkNow,
        );
      }

      if (chunksToRemove.length === 0) {
        throw new Error("Current chunk can not be trimmed from buffer.");
      }

      for (const chunk of chunksToRemove) {
        this.#removeChunk(chunk);
        this.chunkLoader.emitUnloadRequest(chunk, { source: "buffer-limit" });
      }
    }
  }

  /**
   * 获取指定区块的邻居区块
   * @param {Chunk} chunk - 当前区块
   * @param {"right" | "left" | "up" | "down"} direction - 方向
   * @returns {Chunk | undefined} 邻居区块
   * @private
   */
  #getNeighbor(chunk, direction) {
    if (!chunk) return undefined;
    const resolvedNeighbor = this.resolveNeighbor(chunk, direction);
    if (resolvedNeighbor) return resolvedNeighbor;

    const snapshot = this.neighborSnapshot.get(chunk);
    return snapshot?.[direction];
  }

  /**
   * 获取指定方向的边界区块
   * @param {"right" | "left" | "up" | "down"} direction - 方向
   * @returns {Chunk[]}
   * @private
   */
  #getEdgeChunks(direction) {
    if (!this.bufferBounds) return [];

    const edgeChunks = [];
    for (const chunk of this.chunksLoaded.values()) {
      if (
        (direction === "left" && chunk.x === this.bufferBounds.minX) ||
        (direction === "right" && chunk.x === this.bufferBounds.maxX) ||
        (direction === "down" && chunk.y === this.bufferBounds.minY) ||
        (direction === "up" && chunk.y === this.bufferBounds.maxY)
      ) {
        edgeChunks.push(chunk);
      }
    }

    return edgeChunks.sort((left, right) => {
      if (direction === "left" || direction === "right") {
        return right.y - left.y;
      }
      return left.x - right.x;
    });
  }

  /**
   * 判断某区块是否已在缓冲区中
   * @param {Chunk} chunk - 区块实例
   * @returns {boolean}
   * @private
   */
  #hasChunk(chunk) {
    return this.chunkLoader.hasChunk(chunk);
  }

  /**
   * 插入区块到缓冲区
   * @param {Chunk} chunk - 区块实例
   * @private
   */
  #insertChunk(chunk) {
    if (!this.neighborSnapshot.has(chunk)) {
      this.neighborSnapshot.set(chunk, {
        right: chunk.rightChunk,
        left: chunk.leftChunk,
        up: chunk.upChunk,
        down: chunk.downChunk,
      });
    }

    this.chunkLoader.trackChunk(chunk);

    if (!this.bufferBounds) {
      this.bufferBounds = {
        minX: chunk.x,
        maxX: chunk.x,
        minY: chunk.y,
        maxY: chunk.y,
      };
      return;
    }

    this.bufferBounds.minX = Math.min(this.bufferBounds.minX, chunk.x);
    this.bufferBounds.maxX = Math.max(this.bufferBounds.maxX, chunk.x);
    this.bufferBounds.minY = Math.min(this.bufferBounds.minY, chunk.y);
    this.bufferBounds.maxY = Math.max(this.bufferBounds.maxY, chunk.y);
  }

  /**
   * 从缓冲区移除区块
   * @param {Chunk} chunk - 区块实例
   * @private
   */
  #removeChunk(chunk) {
    this.chunkLoader.untrackChunkById(chunk.id);
    this.#recalculateBufferBounds();
  }

  /**
   * 重算缓冲区边界
   * @private
   */
  #recalculateBufferBounds() {
    const chunks = [...this.chunksLoaded.values()];
    if (chunks.length === 0) {
      this.bufferBounds = undefined;
      return;
    }

    let minX = chunks[0].x;
    let maxX = chunks[0].x;
    let minY = chunks[0].y;
    let maxY = chunks[0].y;
    for (const chunk of chunks) {
      minX = Math.min(minX, chunk.x);
      maxX = Math.max(maxX, chunk.x);
      minY = Math.min(minY, chunk.y);
      maxY = Math.max(maxY, chunk.y);
    }
    this.bufferBounds = { minX, maxX, minY, maxY };
  }

  /**
   * 发出缓冲区更新事件
   * @param {"expand" | "shrink" | "move" | "reset"} action - 更新动作
   * @param {"right" | "left" | "up" | "down" | "none"} direction - 更新方向
   * @private
   */
  #emitBufferUpdated(action, direction) {
    this.chunkLoader.emitBufferUpdated({
      action,
      direction,
      chunkNow: this.chunkNow,
      chunksLoaded: this.getLoadedChunks(),
      bufferBounds: this.getBufferBounds(),
    });
  }
}

export { ChunkBlockLoader, CHUNK_LOAD_EVENTS, CHUNK_LOAD_STRATEGIES };
