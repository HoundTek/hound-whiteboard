/**
 * @file 白板物化摘要
 * @description 从 BoardCore 捕获实际对象与 trash 的增量哈希，区分合法未驻留和真正缺席。
 * @module kernel/projection/materialized-board-projection
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { HashTrie } from "../utils/hash-trie.js";
import { hashString } from "../utils/hash.js";
import { canonicalJson } from "../utils/canonical-json.js";
import { hashLayerGraph } from "../board/layer-edges.js";

/**
 * 白板物化摘要
 * @class
 * @author Zhou Chenyu
 */
class MaterializedBoardProjection {
  /**
   * 白板核心
   * @type {import("../board/board-core.js").BoardCore}
   * @private
   */
  #boardCore;

  /**
   * 应然投影（仅为未知未载对象提供初始叶子）
   * @type {import("./derived-board-projection.js").DerivedBoardProjection}
   * @private
   */
  #derived;

  /**
   * 物化对象状态哈希索引
   * @type {HashTrie}
   * @private
   */
  #stateHashes = new HashTrie();

  /**
   * 已写入状态叶子的对象 id
   * @type {Set<string>}
   * @private
   */
  #objectIds = new Set();

  /**
   * 物化静态图哈希索引
   * @type {HashTrie}
   * @private
   */
  #layerHashes = new HashTrie();

  /**
   * 已写入静态图叶子的区块 id
   * @type {Set<string>}
   * @private
   */
  #chunkIds = new Set();

  /**
   * 构造物化摘要
   * @param {import("../board/board-core.js").BoardCore} boardCore - 白板核心
   * @param {import("./derived-board-projection.js").DerivedBoardProjection} derived - 应然投影
   */
  constructor(boardCore, derived) {
    this.#boardCore = boardCore;
    this.#derived = derived;
  }

  /**
   * 物化对象状态根哈希
   * @type {string}
   */
  get stateHash() {
    return this.#stateHashes.rootHash;
  }

  /**
   * 物化层序根哈希
   * @type {string}
   */
  get layerHash() {
    return this.#layerHashes.rootHash;
  }

  /**
   * 物化层序哈希索引
   * @returns {HashTrie} 哈希索引
   */
  getLayerHashes() {
    return this.#layerHashes;
  }

  /**
   * 物化对象状态哈希索引
   * @returns {HashTrie} 哈希索引
   */
  getStateHashes() {
    return this.#stateHashes;
  }

  /**
   * 重捕对象与静态图状态；缺省扫描当前已知对象、区块与既有叶子
   * @param {{objectIds?: Iterable<string>}} [options] - 定点重捕选项
   * @returns {void}
   */
  refresh({ objectIds, chunkIds } = {}) {
    const captureAll = objectIds === undefined && chunkIds === undefined;
    const ids = objectIds ?? (captureAll ? new Set([
      ...this.#objectIds,
      ...this.#boardCore.getKnownObjectIds(),
      ...this.#boardCore.trash.keys(),
    ]) : []);
    for (const id of ids) this.#captureObject(id);
    const layers = chunkIds ?? (captureAll ? new Set([
      ...this.#chunkIds,
      ...this.#boardCore.chunkLoaded.keys(),
      ...this.#derived.getGraphEntries().map(([chunkId]) => chunkId),
    ]) : []);
    for (const chunkId of layers) this.#captureChunk(chunkId);
  }

  /**
   * 捕获单个区块的实际静态图
   * @param {number|string} chunkId - 区块 id
   * @returns {void}
   * @private
   */
  #captureChunk(chunkId) {
    const id = Number(chunkId);
    const key = String(id);
    const graph = this.#boardCore.chunkLoaded.get(id)?.chunk?.objectManager?.staticGraph;
    if (graph) {
      if (graph.getNodes().length === 0) {
        this.#chunkIds.delete(key);
        this.#layerHashes.delete(key);
      } else {
        this.#chunkIds.add(key);
        this.#layerHashes.set(key, hashLayerGraph(graph));
      }
      return;
    }
    if (!this.#chunkIds.has(key)) {
      const derivedHash = this.#derived.getLayerHashes().get(key);
      if (derivedHash !== undefined) {
        this.#chunkIds.add(key);
        this.#layerHashes.set(key, derivedHash);
      }
    }
  }

  /**
   * 捕获单个对象的实际状态
   * @param {string} id - 对象 id
   * @returns {void}
   * @private
   */
  #captureObject(id) {
    const obj = this.#boardCore.getObjectById(id);
    if (obj) {
      this.#set(id, { location: "objects", data: obj.serialize() });
      return;
    }
    if (this.#boardCore.trash.has(id)) {
      this.#set(id, { location: "trash", ...this.#boardCore.trash.get(id) });
      return;
    }
    const legallyUnloaded = this.#boardCore.isObjectLegallyUnloaded(id);
    if (legallyUnloaded) {
      if (!this.#objectIds.has(id)) {
        const derivedHash = this.#derived.getStateHashes().get(id);
        if (derivedHash !== undefined) this.#setHash(id, derivedHash);
      }
      return;
    }
    this.#delete(id);
  }

  /**
   * 写入规范化对象状态
   * @param {string} id - 对象 id
   * @param {Object} value - 状态值
   * @returns {void}
   * @private
   */
  #set(id, value) {
    this.#setHash(id, hashString(canonicalJson(value)));
  }

  /**
   * 写入状态哈希
   * @param {string} id - 对象 id
   * @param {string} valueHash - 状态哈希
   * @returns {void}
   * @private
   */
  #setHash(id, valueHash) {
    this.#objectIds.add(id);
    this.#stateHashes.set(id, valueHash);
  }

  /**
   * 删除对象状态叶子
   * @param {string} id - 对象 id
   * @returns {void}
   * @private
   */
  #delete(id) {
    this.#objectIds.delete(id);
    this.#stateHashes.delete(id);
  }
}

export { MaterializedBoardProjection };
