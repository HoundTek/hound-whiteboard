/**
 * @file 通用区块加载器
 * @description 提供面向区块实例持有与索引的基础能力。
 * @module core/components/chunk-loader
 * @author Zhou Chenyu
 */

import { Chunk } from "./chunk.js";
import { EventBus } from "../utils/event-bus.js";

const CHUNK_LOAD_EVENTS = Object.freeze({
  REQUEST_LOAD: "chunk-block-loader:request-load",
  REQUEST_UNLOAD: "chunk-block-loader:request-unload",
  BUFFER_UPDATED: "chunk-block-loader:buffer-updated",
});

/**
 * 通用区块加载器。
 * @description
 * `ChunkLoader` 是区块对象的直接持有者。
 * 它负责缓存区块实例，并提供按区块 id 或二维坐标访问、卸载与清空的统一入口。
 * 它不表达“当前区块”、连续矩形缓冲区，或完整/临时加载策略。
 */
class ChunkLoader {
  /**
   * 当前持有的区块实例映射。
   * @description 以区块 id 为键保存已进入当前 loader 作用域的区块实例。
   * @type {Map<number, Chunk>}
   */
  chunksLoaded;

  /**
   * 区块实例解析器。
   * @description 用于在缓存未命中时解析某个区块 id 对应的区块实例。
   * @type {((chunkId: number) => Chunk | undefined) | undefined}
   */
  resolveChunkById;

  /**
   * 区块卸载钩子。
   * @description 用于在区块从当前 loader 中移除前执行额外的卸载或拒绝逻辑。
   * @type {((chunk: Chunk) => boolean | void) | undefined}
   */
  unloadChunk;

  /**
   * 区块加载相关事件总线。
   * @type {EventBus | undefined}
   */
  eventBus;

  /**
   * 当前 loader 在事件总线中的请求方 id。
   * @type {number | string | undefined}
   */
  requesterId;

  /**
   * @param {{ resolveChunkById?: (chunkId: number) => Chunk | undefined, unloadChunk?: (chunk: Chunk) => boolean | void, eventBus?: EventBus, requesterId?: number | string }} [options] - loader 选项
   */
  constructor({ resolveChunkById, unloadChunk, eventBus, requesterId } = {}) {
    this.chunksLoaded = new Map();
    this.resolveChunkById = resolveChunkById;
    this.unloadChunk = unloadChunk;
    this.eventBus = eventBus;
    this.requesterId = requesterId;
  }

  /**
   * 配置当前 loader 的请求上下文。
   * @param {{ eventBus?: EventBus, requesterId?: number | string }} [options] - 请求上下文
   * @returns {ChunkLoader}
   */
  configureRequestContext({ eventBus, requesterId } = {}) {
    this.eventBus = eventBus;
    this.requesterId = requesterId;
    return this;
  }

  /**
   * 当前已持有区块数。
   * @returns {number}
   */
  get chunksLoadedCount() {
    return this.chunksLoaded.size;
  }

  /**
   * 返回当前持有的区块快照。
   * @returns {Chunk[]} 当前 loader 持有的区块列表
   */
  getLoadedChunks() {
    return [...this.chunksLoaded.values()];
  }

  /**
   * 判断区块是否已被当前 loader 持有。
   * @param {Chunk} chunk - 候选区块
   * @returns {boolean}
   */
  hasChunk(chunk) {
    return chunk instanceof Chunk && this.chunksLoaded.has(chunk.id);
  }

  /**
   * 将区块实例纳入当前 loader 管理。
   * @param {Chunk} chunk - 区块实例
   * @returns {Chunk} 被纳入管理的区块实例
   * @throws {TypeError} 当输入不是合法 `Chunk` 时抛出错误
   */
  trackChunk(chunk) {
    if (!(chunk instanceof Chunk)) {
      throw new TypeError("Invalid chunk instance.");
    }

    chunk.assertValid();
    this.chunksLoaded.set(chunk.id, chunk);
    this.#refreshLoadedNeighborRefs();
    return chunk;
  }

  /**
   * 按区块 id 获取区块实例。
   * @description 若当前 loader 尚未持有该区块，会先通过 `resolveChunkById` 或 `Chunk.fromId` 创建，再纳入持有范围。
   * @param {number} chunkId - 区块 id
   * @returns {Chunk | undefined}
   */
  getChunkById(chunkId) {
    if (!Number.isInteger(chunkId) || chunkId <= 0) return undefined;

    const existingChunk = this.chunksLoaded.get(chunkId);
    if (existingChunk) return existingChunk;

    const chunk = this.resolveChunkById
      ? this.resolveChunkById(chunkId)
      : Chunk.fromId(chunkId);
    if (!(chunk instanceof Chunk)) return undefined;

    return this.trackChunk(chunk);
  }

  /**
   * 按二维坐标获取区块实例。
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {Chunk | undefined}
   */
  getChunkByCoordinate(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
    return this.getChunkById(Chunk.coordinateToId(x, y));
  }

  /**
   * 按区块 id 卸载区块。
   * @param {number} chunkId - 区块 id
   * @returns {boolean} 是否成功从当前 loader 移除
   */
  unloadChunkById(chunkId) {
    if (!Number.isInteger(chunkId) || chunkId <= 0) return false;

    const chunk = this.chunksLoaded.get(chunkId);
    if (!chunk) return false;

    if (typeof this.unloadChunk === "function") {
      const unloaded = this.unloadChunk(chunk);
      if (unloaded === false) return false;
    }

    return this.untrackChunkById(chunkId);
  }

  /**
   * 按二维坐标卸载区块。
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {boolean} 是否成功从当前 loader 移除
   */
  unloadChunkByCoordinate(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    return this.unloadChunkById(Chunk.coordinateToId(x, y));
  }

  /**
   * 卸载并清空当前 loader 持有的全部区块。
   * @returns {boolean} 是否全部成功卸载并移除
   */
  clear() {
    let cleared = true;
    for (const chunkId of [...this.chunksLoaded.keys()]) {
      if (!this.unloadChunkById(chunkId)) {
        cleared = false;
      }
    }
    return cleared && this.chunksLoaded.size === 0;
  }

  /**
   * 只重置当前 loader 的持有关系。
   * @description 该方法不会触发 `unloadChunk` 钩子，适合由包装层在自定义卸载时序中使用。
   */
  reset() {
    this.chunksLoaded.clear();
  }

  /**
   * 仅从当前 loader 的持有关系中移除区块。
   * @param {number} chunkId - 区块 id
   * @returns {boolean}
   */
  untrackChunkById(chunkId) {
    if (!this.chunksLoaded.has(chunkId)) return false;
    this.chunksLoaded.delete(chunkId);
    this.#refreshLoadedNeighborRefs();
    return true;
  }

  /**
   * 发出区块加载请求。
   * @param {Chunk} chunk - 要加载的区块
   * @param {{ strategy: "temp" | "full", direction?: "right" | "left" | "up" | "down", source?: string, alreadyBuffered?: boolean }} payload - 事件载荷
   * @returns {boolean}
   */
  emitLoadRequest(
    chunk,
    { strategy, direction, source, alreadyBuffered = false } = {},
  ) {
    if (!(this.eventBus instanceof EventBus)) return false;
    this.eventBus.emit(CHUNK_LOAD_EVENTS.REQUEST_LOAD, {
      requesterId: this.requesterId,
      chunk,
      strategy,
      direction,
      source,
      alreadyBuffered,
    });
    return true;
  }

  /**
   * 发出区块卸载请求。
   * @param {Chunk} chunk - 要卸载的区块
   * @param {{ source?: string }} payload - 事件载荷
   * @returns {boolean}
   */
  emitUnloadRequest(chunk, { source } = {}) {
    if (!(this.eventBus instanceof EventBus)) return false;
    this.eventBus.emit(CHUNK_LOAD_EVENTS.REQUEST_UNLOAD, {
      requesterId: this.requesterId,
      chunk,
      source,
    });
    return true;
  }

  /**
   * 发出缓冲区更新事件。
   * @param {{ action: "expand" | "shrink" | "move" | "reset", direction: "right" | "left" | "up" | "down" | "none", chunkNow?: Chunk, chunksLoaded?: Chunk[], bufferBounds?: { minX: number, maxX: number, minY: number, maxY: number } | undefined }} payload - 事件载荷
   * @returns {boolean}
   */
  emitBufferUpdated({
    action,
    direction,
    chunkNow,
    chunksLoaded,
    bufferBounds,
  }) {
    if (!(this.eventBus instanceof EventBus)) return false;
    this.eventBus.emit(CHUNK_LOAD_EVENTS.BUFFER_UPDATED, {
      action,
      direction,
      chunkNow,
      chunksLoaded,
      bufferBounds,
    });
    return true;
  }

  /**
   * 重新同步当前已持有区块之间的四向邻接引用。
   * @description 当前 loader 只负责同步“已持有集合内部”的邻接关系，不会主动解析外部区块。
   */
  #refreshLoadedNeighborRefs() {
    for (const chunk of this.chunksLoaded.values()) {
      chunk.leftChunk = undefined;
      chunk.rightChunk = undefined;
      chunk.upChunk = undefined;
      chunk.downChunk = undefined;
    }

    for (const chunk of this.chunksLoaded.values()) {
      const directions = [
        ["right", 1, 0],
        ["left", -1, 0],
        ["up", 0, 1],
        ["down", 0, -1],
      ];

      for (const [direction, deltaX, deltaY] of directions) {
        const neighborId = Chunk.coordinateToId(
          chunk.x + deltaX,
          chunk.y + deltaY,
        );
        const neighbor = this.chunksLoaded.get(neighborId);
        if (!neighbor) continue;
        Chunk.connectTwoChunk(chunk, neighbor, direction);
      }
    }
  }
}

export { ChunkLoader, CHUNK_LOAD_EVENTS };
