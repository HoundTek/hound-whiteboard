/**
 * @file 区块加载器
 * @description 提供面向区块实例持有与索引的基础能力。
 * @module core/worker/components/chunk/chunk-loader
 * @author Zhou Chenyu
 */

import { Chunk } from "./chunk.js";
import { EventBus } from "../../../utils/event-bus.js";

const CHUNK_LOAD_EVENTS = Object.freeze({
  REQUEST_LOAD: "chunk-loader:request-load",
  REQUEST_UNLOAD: "chunk-loader:request-unload",
  BUFFER_UPDATED: "chunk-loader:buffer-updated",
  LOAD_COMPLETE: "chunk-loader:load-complete",
});

const CHUNK_LOAD_STRATEGIES = Object.freeze({
  TEMP: "temp",
  FULL: "full",
});

/**
 * 区块加载器
 * @description
 * `ChunkLoader` 是区块对象的直接持有者。
 * 它负责缓存区块实例，并提供按区块 id 或二维坐标访问、卸载与清空的统一入口。
 * 它不表达“当前区块”、连续矩形缓冲区，或完整/临时加载策略。
 */
class ChunkLoader {
  /**
   * 当前持有的区块实例映射
   * @description 以区块 id 为键保存已进入当前 loader 作用域的区块实例。
   * @type {Map<number, Chunk>}
   */
  chunksLoaded;

  /**
   * 区块实例解析器
   * @description 用于在缓存未命中时解析某个区块 id 对应的区块实例。
   * @type {((chunkId: number) => Chunk | undefined) | undefined}
   */
  resolveChunkById;

  /**
   * 区块卸载钩子
   * @description 用于在区块从当前 loader 中移除前执行额外的卸载或拒绝逻辑。
   * @type {((chunk: Chunk) => boolean | void) | undefined}
   */
  unloadChunk;

  /**
   * 区块加载相关事件总线
   * @type {EventBus | undefined}
   */
  eventBus;

  /**
   * 当前 loader 在事件总线中的请求方 id
   * @type {number | string | undefined}
   */
  requesterId;

  /**
   * 挂起的销毁定时器句柄
   * @type {ReturnType<typeof setTimeout> | undefined}
   */
  #pendingDestroyTimer;

  /**
   * 是否已完成销毁
   * @type {boolean}
   */
  #isDestroyed = false;

  /**
   * @param {{ resolveChunkById?: (chunkId: number) => Chunk | undefined, unloadChunk?: (chunk: Chunk) => boolean | void, eventBus?: EventBus, requesterId?: number | string }} [options] - loader 选项
   * @constructor
   */
  constructor({ resolveChunkById, unloadChunk, eventBus, requesterId } = {}) {
    this.chunksLoaded = new Map();
    this.resolveChunkById = resolveChunkById;
    this.unloadChunk = unloadChunk;
    this.eventBus = eventBus;
    this.requesterId = requesterId;
  }

  /**
   * 配置当前 loader 的请求上下文
   * @param {{ eventBus?: EventBus, requesterId?: number | string }} [options] - 请求上下文
   * @returns {ChunkLoader}
   */
  configureRequestContext({ eventBus, requesterId } = {}) {
    this.#cancelScheduledDestroyIfPending();
    this.eventBus = eventBus;
    this.requesterId = requesterId;
    return this;
  }

  /**
   * 当前已持有区块数
   * @returns {number}
   */
  get chunksLoadedCount() {
    return this.chunksLoaded.size;
  }

  /**
   * 返回当前持有的区块快照
   * @returns {Chunk[]} 当前 loader 持有的区块列表
   */
  getLoadedChunks() {
    return [...this.chunksLoaded.values()];
  }

  /**
   * 判断区块是否已被当前 loader 持有
   * @param {Chunk} chunk - 候选区块
   * @returns {boolean}
   */
  hasChunk(chunk) {
    return chunk instanceof Chunk && this.chunksLoaded.has(chunk.id);
  }

  /**
   * 将区块实例纳入当前 loader 管理
   * @param {Chunk} chunk - 区块实例
   * @returns {Chunk} 被纳入管理的区块实例
   * @throws {TypeError} 当输入不是合法 `Chunk` 时抛出错误
   */
  trackChunk(chunk) {
    this.#cancelScheduledDestroyIfPending();

    if (!(chunk instanceof Chunk)) {
      throw new TypeError("Invalid chunk instance.");
    }

    chunk.assertValid();
    this.chunksLoaded.set(chunk.id, chunk);
    this.#refreshLoadedNeighborRefs();
    return chunk;
  }

  /**
   * 按区块 id 获取区块实例
   * @description 若当前 loader 尚未持有该区块，会先通过 `resolveChunkById` 或 `Chunk.fromId` 创建，再纳入持有范围。
   * @param {number} chunkId - 区块 id
   * @returns {Chunk | undefined}
   */
  getChunkById(chunkId) {
    if (!Number.isInteger(chunkId) || chunkId <= 0) return undefined;

    this.#cancelScheduledDestroyIfPending();

    const existingChunk = this.chunksLoaded.get(chunkId);
    if (existingChunk) return existingChunk;

    const chunk = this.resolveChunkById
      ? this.resolveChunkById(chunkId)
      : Chunk.fromId(chunkId);
    if (!(chunk instanceof Chunk)) return undefined;

    return this.trackChunk(chunk);
  }

  /**
   * 按二维坐标获取区块实例
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {Chunk | undefined}
   */
  getChunkByCoordinate(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
    return this.getChunkById(Chunk.coordinateToId(x, y));
  }

  /**
   * 按区块 id 卸载区块
   * @param {number} chunkId - 区块 id
   * @returns {boolean} 是否成功从当前 loader 移除
   */
  unloadChunkById(chunkId) {
    if (!Number.isInteger(chunkId) || chunkId <= 0) return false;

    this.#cancelScheduledDestroyIfPending();

    const chunk = this.chunksLoaded.get(chunkId);
    if (!chunk) return false;

    if (typeof this.unloadChunk === "function") {
      const unloaded = this.unloadChunk(chunk);
      if (unloaded === false) return false;
    }

    return this.untrackChunkById(chunkId);
  }

  /**
   * 按二维坐标卸载区块
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {boolean} 是否成功从当前 loader 移除
   */
  unloadChunkByCoordinate(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    return this.unloadChunkById(Chunk.coordinateToId(x, y));
  }

  /**
   * 卸载并清空当前 loader 持有的全部区块
   * @returns {boolean} 是否全部成功卸载并移除
   */
  clear() {
    this.#cancelScheduledDestroyIfPending();

    let cleared = true;
    for (const chunkId of [...this.chunksLoaded.keys()]) {
      if (!this.unloadChunkById(chunkId)) {
        cleared = false;
      }
    }
    return cleared && this.chunksLoaded.size === 0;
  }

  /**
   * 取消已挂起的销毁定时（若有）
   * @returns {boolean} 是否成功取消（有正在挂起的定时并已清除）
   */
  cancelScheduledDestroy() {
    if (this.#pendingDestroyTimer !== undefined) {
      clearTimeout(this.#pendingDestroyTimer);
      this.#pendingDestroyTimer = undefined;
      return true;
    }
    return false;
  }

  /**
   * 只重置当前 loader 的持有关系
   * @description 该方法不会触发 `unloadChunk` 钩子，适合由包装层在自定义卸载时序中使用。
   */
  reset() {
    this.#cancelScheduledDestroyIfPending();
    this.chunksLoaded.clear();
  }

  /**
   * 仅从当前 loader 的持有关系中移除区块
   * @param {number} chunkId - 区块 id
   * @returns {boolean}
   */
  untrackChunkById(chunkId) {
    this.#cancelScheduledDestroyIfPending();
    if (!this.chunksLoaded.has(chunkId)) return false;
    this.chunksLoaded.delete(chunkId);
    this.#refreshLoadedNeighborRefs();
    return true;
  }

  /**
   * 发出区块加载请求
   * @param {Chunk} chunk - 要加载的区块
   * @param {{ strategy: "temp" | "full", direction?: "right" | "left" | "up" | "down", source?: string, alreadyBuffered?: boolean }} payload - 事件载荷
   * @returns {boolean}
   */
  emitLoadRequest(
    chunk,
    { strategy, direction, source, alreadyBuffered = false } = {},
  ) {
    this.#cancelScheduledDestroyIfPending();

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
   * 发出区块卸载请求
   * @param {Chunk} chunk - 要卸载的区块
   * @param {{ source?: string }} payload - 事件载荷
   * @returns {boolean}
   */
  emitUnloadRequest(chunk, { source } = {}) {
    this.#cancelScheduledDestroyIfPending();

    if (!(this.eventBus instanceof EventBus)) return false;
    this.eventBus.emit(CHUNK_LOAD_EVENTS.REQUEST_UNLOAD, {
      requesterId: this.requesterId,
      chunk,
      source,
    });
    return true;
  }

  /**
   * 发出缓冲区更新事件
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
    this.#cancelScheduledDestroyIfPending();

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
   * 销毁当前 ChunkLoader
   * @description 对所有已持有区块发出卸载请求以清理 board-core 的引用计数，清空本地持有，释放外部引用。
   * 若传入 `delayMs`，则定时到期后再执行实际销毁；定时期间可通过 `cancelScheduledDestroy()`
   * 取消，或通过任何追踪/访问方法（trackChunk、getChunkById 等）自动取消。
   * @param {number} [delayMs] - 延迟销毁的毫秒数。省略或 ≤0 则立即销毁。
   */
  destroy(delayMs) {
    this.#cancelPendingDestroyTimer();

    if (typeof delayMs === "number" && delayMs > 0) {
      this.#pendingDestroyTimer = setTimeout(() => {
        this.#pendingDestroyTimer = undefined;
        this.#performDestroy();
      }, delayMs);
      return;
    }

    this.#performDestroy();
  }

  /**
   * 执行实际销毁
   * @description 发出卸载请求、释放引用、标记已销毁。
   * @private
   */
  #performDestroy() {
    for (const chunk of this.chunksLoaded.values()) {
      this.eventBus?.emit(CHUNK_LOAD_EVENTS.REQUEST_UNLOAD, {
        requesterId: this.requesterId,
        chunk,
      });
    }

    this.chunksLoaded.clear();
    this.eventBus = undefined;
    this.resolveChunkById = undefined;
    this.unloadChunk = undefined;
    this.requesterId = undefined;
    this.#isDestroyed = true;
  }

  /**
   * 清除挂起的销毁定时（若有）
   * @private
   */
  #cancelPendingDestroyTimer() {
    if (this.#pendingDestroyTimer !== undefined) {
      clearTimeout(this.#pendingDestroyTimer);
      this.#pendingDestroyTimer = undefined;
    }
  }

  /**
   * 若挂有销毁定时则自动取消
   * @description 当 loader 仍有活跃操作时调用，避免定时器到期误销毁。
   * @private
   */
  #cancelScheduledDestroyIfPending() {
    if (this.#pendingDestroyTimer !== undefined) {
      clearTimeout(this.#pendingDestroyTimer);
      this.#pendingDestroyTimer = undefined;
    }
  }

  /**
   * 重新同步当前已持有区块之间的四向邻接引用
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

export { ChunkLoader, CHUNK_LOAD_EVENTS, CHUNK_LOAD_STRATEGIES };
