/**
 * @file 白板应然投影
 * @description 以纯序列化数据正放和逆放活动记录，维护对象、trash 与增量状态摘要。
 * @module kernel/projection/derived-board-projection
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { OPERATION_TYPES } from "../hit/operation.js";
import { HashTrie } from "../utils/hash-trie.js";
import { hashString } from "../utils/hash.js";
import { canonicalJson } from "../utils/canonical-json.js";
import { DerivedLayerProjection } from "./derived-layer-projection.js";

/**
 * 将快照补丁合并到纯数据快照
 * @param {Object} snapshot - 原快照
 * @param {Object} patch - 快照补丁
 * @returns {Object} 新快照
 * @private
 */
function patchSnapshot(snapshot, patch) {
  const next = { ...snapshot };
  if (patch.position != null) next.position = { ...patch.position };
  if (patch.transform != null) next.transform = { ...patch.transform };
  if (patch.property != null) next.property = { ...snapshot.property, ...patch.property };
  if (patch.data != null) next.data = { ...snapshot.data, ...patch.data };
  if (typeof patch.append?.key === "string") {
    const key = patch.append.key;
    next.data = {
      ...next.data,
      [key]: [...(next.data[key] ?? []), ...(patch.append.items ?? [])],
    };
  }
  return next;
}

/**
 * 归一化 trash 层位边为可序列化数组
 * @param {Array} chunks - 层位边集合
 * @returns {Array} 归一化层位边
 * @private
 */
function normalizeChunks(chunks) {
  return (chunks ?? []).map((entry) => ({
    ...entry,
    below: [...(entry.below ?? [])],
    above: [...(entry.above ?? [])],
  }));
}

/**
 * 白板应然投影
 * @description 采用远程记录应用口径，不构造 BoardCore、AOM 或 BasicObject 实例。
 * @class
 * @author Zhou Chenyu
 */
class DerivedBoardProjection {
  /**
   * 存活对象快照
   * @type {Map<string, Object>}
   * @private
   */
  #objects = new Map();

  /**
   * trash 条目
   * @type {Map<string, {data: Object, chunks: Array}>}
   * @private
   */
  #trash = new Map();

  /**
   * 对象与 trash 的增量哈希索引
   * @type {HashTrie}
   * @private
   */
  #stateHashes = new HashTrie();

  /**
   * 应然层序投影
   * @type {DerivedLayerProjection}
   * @private
   */
  #layer;

  /**
   * 构造白板应然投影
   * @param {{width?: number, height?: number}} [options] - 区块边长
   */
  constructor({ width = 1024, height = 1024 } = {}) {
    this.#layer = new DerivedLayerProjection({
      width,
      height,
      getSnapshot: (id) => this.#objects.get(id),
    });
  }

  /**
   * 对象状态根哈希
   * @type {string}
   */
  get stateHash() {
    return this.#stateHashes.rootHash;
  }

  /**
   * 层序根哈希
   * @type {string}
   */
  get layerHash() {
    return this.#layer.layerHash;
  }

  /**
   * 层序哈希索引
   * @returns {HashTrie} 哈希索引
   */
  getLayerHashes() {
    return this.#layer.getLayerHashes();
  }

  /**
   * 读取区块静态图
   * @param {number} chunkId - 区块 id
   * @returns {import("../utils/directed-graph.js").DirectedGraph|undefined} 静态图
   */
  getGraph(chunkId) {
    return this.#layer.getGraph(chunkId);
  }

  /**
   * 导出全部区块静态图
   * @returns {Array<[number, import("../utils/directed-graph.js").DirectedGraph]>} 图表条目
   */
  getGraphEntries() {
    return this.#layer.getGraphEntries();
  }

  /**
   * 读取对象覆盖区块
   * @param {string} objectId - 对象 id
   * @returns {Set<number>} 覆盖区块集合
   */
  getCoverChunks(objectId) {
    return this.#layer.getCoverChunks(objectId);
  }

  /**
   * 对象状态哈希索引
   * @returns {HashTrie} 哈希索引
   */
  getStateHashes() {
    return this.#stateHashes;
  }

  /**
   * 读取单个对象投影
   * @param {string} id - 对象 id
   * @returns {{location: "objects"|"trash"|"absent", data?: Object, chunks?: Array}} 对象投影
   */
  getObject(id) {
    if (this.#objects.has(id)) {
      return { location: "objects", data: this.#objects.get(id) };
    }
    if (this.#trash.has(id)) {
      const entry = this.#trash.get(id);
      return { location: "trash", data: entry.data, chunks: entry.chunks };
    }
    return { location: "absent" };
  }

  /**
   * 从完整活动记录重建投影
   * @param {import("../hit/operation.js").OperationRecord[]} activeRecords - 活动记录
   * @returns {void}
   */
  rebuild(activeRecords) {
    this.#objects = new Map();
    this.#trash = new Map();
    this.#stateHashes = new HashTrie();
    this.#layer.reset();
    for (const record of activeRecords) this.#apply(record);
  }

  /**
   * 应用活动链过渡
   * @param {{removed: import("../hit/operation.js").OperationRecord[], added: import("../hit/operation.js").OperationRecord[]}} change - 链过渡
   * @returns {void}
   */
  applyTransition({ removed, added }) {
    for (let index = removed.length - 1; index >= 0; index -= 1) {
      this.#revert(removed[index]);
    }
    for (const record of added) this.#apply(record);
  }

  /**
   * 正放一条记录的对象与层序效果
   * @param {import("../hit/operation.js").OperationRecord} record - 操作记录
   * @returns {void}
   * @private
   */
  #apply(record) {
    const previousLocation = typeof record.payload?.objectId === "string"
      ? this.getObject(record.payload.objectId).location
      : "absent";
    this.#applyState(record);
    this.#layer.apply(record, previousLocation);
  }

  /**
   * 逆放一条记录的对象与层序效果
   * @param {import("../hit/operation.js").OperationRecord} record - 操作记录
   * @returns {void}
   * @private
   */
  #revert(record) {
    const previousLocation = typeof record.payload?.objectId === "string"
      ? this.getObject(record.payload.objectId).location
      : "absent";
    this.#revertState(record);
    this.#layer.revert(record, previousLocation);
  }

  /**
   * 正放一条记录的对象数据效果
   * @param {import("../hit/operation.js").OperationRecord} record - 操作记录
   * @returns {void}
   * @private
   */
  #applyState(record) {
    const { type, payload } = record;
    switch (type) {
      case OPERATION_TYPES.ADD_OBJECT:
        if (this.#objects.has(payload.objectId)) return;
        this.#objects.set(payload.objectId, payload.data);
        this.#trash.delete(payload.objectId);
        this.#syncObject(payload.objectId);
        return;
      case OPERATION_TYPES.MODIFY_OBJECT:
        if (this.#objects.has(payload.objectId)) {
          this.#objects.set(
            payload.objectId,
            patchSnapshot(this.#objects.get(payload.objectId), payload.after),
          );
          this.#syncObject(payload.objectId);
        } else if (this.#trash.has(payload.objectId)) {
          this.#trash.get(payload.objectId).data = payload.after;
          this.#syncObject(payload.objectId);
        }
        return;
      case OPERATION_TYPES.DELETE_OBJECT:
        if (!this.#trash.has(payload.objectId)) {
          this.#trash.set(payload.objectId, {
            data: payload.data,
            chunks: normalizeChunks(payload.chunks),
          });
        }
        this.#objects.delete(payload.objectId);
        this.#syncObject(payload.objectId);
        return;
      case OPERATION_TYPES.UNCHOOSE_OBJECT:
        if (record.discard === true && payload.restore !== undefined && this.#objects.has(payload.objectId)) {
          this.#objects.set(
            payload.objectId,
            patchSnapshot(this.#objects.get(payload.objectId), payload.restore),
          );
          this.#syncObject(payload.objectId);
        }
        return;
      default:
        return;
    }
  }

  /**
   * 逆放一条记录的对象数据效果
   * @param {import("../hit/operation.js").OperationRecord} record - 操作记录
   * @returns {void}
   * @private
   */
  #revertState(record) {
    const { type, payload } = record;
    switch (type) {
      case OPERATION_TYPES.ADD_OBJECT:
        this.#objects.delete(payload.objectId);
        this.#syncObject(payload.objectId);
        return;
      case OPERATION_TYPES.MODIFY_OBJECT:
        if (this.#objects.has(payload.objectId)) {
          this.#objects.set(
            payload.objectId,
            patchSnapshot(this.#objects.get(payload.objectId), payload.before),
          );
          this.#syncObject(payload.objectId);
        } else if (this.#trash.has(payload.objectId)) {
          this.#trash.get(payload.objectId).data = payload.before;
          this.#syncObject(payload.objectId);
        }
        return;
      case OPERATION_TYPES.DELETE_OBJECT: {
        const entry = this.#trash.get(payload.objectId);
        if (!entry || this.#objects.has(payload.objectId)) return;
        this.#objects.set(payload.objectId, entry.data);
        this.#trash.delete(payload.objectId);
        this.#syncObject(payload.objectId);
        return;
      }
      default:
        return;
    }
  }

  /**
   * 同步单个对象的状态哈希叶子
   * @param {string} id - 对象 id
   * @returns {void}
   * @private
   */
  #syncObject(id) {
    const projection = this.getObject(id);
    if (projection.location === "absent") {
      this.#stateHashes.delete(id);
      return;
    }
    const value = projection.location === "objects"
      ? { location: "objects", data: projection.data }
      : { location: "trash", data: projection.data, chunks: projection.chunks };
    this.#stateHashes.set(id, hashString(canonicalJson(value)));
  }
}

export { DerivedBoardProjection };
