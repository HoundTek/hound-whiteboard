/**
 * @file owner 驻留缓存
 * @description 以区块为粒度持有 owner 工作集，LRU 驱逐并保护 AOM 成员所在区块。
 * @module kernel/board/residency-cache
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

/** 默认驻留区块预算 */
const DEFAULT_OWNER_RESIDENT_CHUNKS = 32;

/**
 * owner 驻留缓存
 * @description
 * 内部持有一个 ChunkLoader，以 FULL 策略持有工作集区块；`ensureChunks` 加载缺失区块并
 * 更新 LRU，超出预算时从最久未使用的区块开始驱逐。AOM 成员（活动对象、pickup 的非活动
 * 层成员、远程选择成员）所在区块与当前操作需要的区块不驱逐；预算可临时超出。
 */
class OwnerResidencyCache {
  /**
   * 板核心
   * @type {import("./board-core.js").BoardCore}
   * @private
   */
  #boardCore;

  /**
   * 驻留区块持有者
   * @type {import("../chunk/chunk-loader.js").ChunkLoader}
   * @private
   */
  #loader;

  /**
   * 区块预算（FULL 持有的区块数）
   * @type {number}
   * @private
   */
  #budget;

  /**
   * 区块访问顺序（Map 的插入顺序即 LRU）
   * @type {Map<number, true>}
   * @private
   */
  #lru = new Map();

  /**
   * 是否已销毁
   * @type {boolean}
   * @private
   */
  #closed = false;

  /**
   * @param {import("./board-core.js").BoardCore} boardCore - 板核心
   * @param {{ maxChunks?: number, requesterId?: string }} [options={}] - 缓存选项
   */
  constructor(boardCore, { maxChunks = DEFAULT_OWNER_RESIDENT_CHUNKS, requesterId = "owner-cache" } = {}) {
    if (!Number.isInteger(maxChunks) || maxChunks <= 0) {
      throw new TypeError("OwnerResidencyCache maxChunks 必须是正整数");
    }
    this.#boardCore = boardCore;
    this.#budget = maxChunks;
    this.#loader = boardCore.createChunkLoader(requesterId);
  }

  /**
   * 读取区块预算
   * @returns {number} FULL 持有的区块数上限
   */
  get budget() {
    return this.#budget;
  }

  /**
   * 确保对象所在区块驻留
   * @param {Iterable<string>} objectIds - 对象 id 集合
   * @returns {Promise<void>}
   */
  async ensureObjects(objectIds) {
    const chunkIds = new Set();
    for (const objectId of objectIds ?? []) {
      const covered = this.#boardCore.getObjectCoverChunks(objectId);
      for (const chunkId of covered ?? []) chunkIds.add(chunkId);
    }
    await this.ensureChunks([...chunkIds]);
  }

  /**
   * 确保区块 FULL 驻留并维护 LRU
   * @param {Iterable<number>} chunkIds - 区块 id 集合
   * @returns {Promise<void>}
   */
  async ensureChunks(chunkIds) {
    if (this.#closed) return;
    const ids = [
      ...new Set(
        (Array.isArray(chunkIds) ? chunkIds : []).filter(Number.isInteger),
      ),
    ];
    if (ids.length === 0) return;

    const missing = ids.filter(
      (chunkId) => !this.#loader.chunksLoaded.has(chunkId),
    );
    const chunks = missing
      .map((chunkId) => this.#boardCore.getChunkById(chunkId))
      .filter(Boolean);
    if (chunks.length > 0) {
      await this.#boardCore.loadChunksIntoLoader(this.#loader, chunks);
    }
    for (const chunkId of ids) this.#touch(chunkId);
    await this.#evict(new Set(ids));
  }

  /**
   * 读取缓存统计
   * @returns {{budget: number, fullChunks: number, residentObjects: number, pinnedChunks: number}} 统计
   */
  stats() {
    return {
      budget: this.#budget,
      fullChunks: this.#loader.chunksLoaded.size,
      residentObjects: this.#boardCore.objectLoaded.size,
      pinnedChunks: this.#boardCore.getPinnedChunkIds().size,
    };
  }

  /**
   * 销毁缓存：释放全部持有
   * @returns {void}
   */
  destroy() {
    if (this.#closed) return;
    this.#closed = true;
    this.#lru.clear();
    this.#loader.destroy();
  }

  /**
   * 更新区块访问顺序
   * @param {number} chunkId - 区块 id
   * @returns {void}
   * @private
   */
  #touch(chunkId) {
    this.#lru.delete(chunkId);
    this.#lru.set(chunkId, true);
  }

  /**
   * 驱逐超出预算且未被固定的区块
   * @param {Set<number>} keep - 当前操作需要的区块
   * @returns {Promise<void>}
   * @private
   */
  async #evict(keep) {
    if (this.#lru.size <= this.#budget) return;
    const pinned = this.#boardCore.getPinnedChunkIds();
    for (const chunkId of [...this.#lru.keys()]) {
      if (this.#lru.size <= this.#budget) break;
      if (keep.has(chunkId) || pinned.has(chunkId)) continue;
      const chunk = this.#loader.chunksLoaded.get(chunkId);
      if (!chunk) {
        this.#lru.delete(chunkId);
        continue;
      }
      this.#loader.emitUnloadRequest(chunk);
      this.#loader.untrackChunkById(chunkId);
      this.#lru.delete(chunkId);
    }
  }
}

/**
 * 创建 owner 驻留缓存
 * @param {import("./board-core.js").BoardCore} boardCore - 板核心
 * @param {{ maxChunks?: number, requesterId?: string }} [options={}] - 缓存选项
 * @returns {OwnerResidencyCache} 驻留缓存
 */
function createOwnerResidencyCache(boardCore, options = {}) {
  return new OwnerResidencyCache(boardCore, options);
}

export {
  DEFAULT_OWNER_RESIDENT_CHUNKS,
  OwnerResidencyCache,
  createOwnerResidencyCache,
};
