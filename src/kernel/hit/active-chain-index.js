/**
 * @file 活动链增量索引
 * @description 以确定性平衡树维护活动记录序列、聚合哈希和前后链过渡后缀。
 * @module kernel/hit/active-chain-index
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { hashString } from "../utils/hash.js";
import { canonicalJson } from "../utils/canonical-json.js";

/** 空索引根哈希。 */
const EMPTY_ROOT_HASH = hashString("active-chain:empty");

/**
 * 创建序列节点
 * @param {import("./operation.js").OperationRecord} record - 操作记录
 * @returns {Object} 序列节点
 * @private
 */
function createNode(record) {
  return {
    record,
    priority: hashString(record.id),
    left: null,
    right: null,
    parent: null,
    size: 1,
    hash: "",
  };
}

/**
 * 读取节点大小
 * @param {?Object} node - 节点
 * @returns {number} 节点数量
 * @private
 */
function sizeOf(node) {
  return node?.size ?? 0;
}

/**
 * 比较两个节点的堆优先级
 * @param {Object} left - 左节点
 * @param {Object} right - 右节点
 * @returns {number} 左节点优先级更高时为正
 * @private
 */
function comparePriority(left, right) {
  if (left.priority !== right.priority) {
    return left.priority > right.priority ? 1 : -1;
  }
  if (left.record.id === right.record.id) return 0;
  return left.record.id > right.record.id ? 1 : -1;
}

/**
 * 活动链增量索引
 * @description 序列位置由活动链决定，treap 堆序由记录 id 决定；同一最终序列恒得同一结构和根哈希。
 * @class
 * @author Zhou Chenyu
 */
class ActiveChainIndex {
  /**
   * 根节点
   * @type {?Object}
   * @private
   */
  #root = null;

  /**
   * 记录 id 到序列节点的索引
   * @type {Map<string, Object>}
   * @private
   */
  #byId = new Map();

  /**
   * 根哈希
   * @type {string}
   */
  get rootHash() {
    return this.#root?.hash ?? EMPTY_ROOT_HASH;
  }

  /**
   * 活动记录数
   * @type {number}
   */
  get size() {
    return sizeOf(this.#root);
  }

  /**
   * 在链尾追加记录
   * @param {import("./operation.js").OperationRecord[]} records - 新记录
   * @returns {{diverge: number, removed: import("./operation.js").OperationRecord[], added: import("./operation.js").OperationRecord[]}} 链变化
   */
  append(records) {
    return this.insertBefore(null, records);
  }

  /**
   * 在指定记录前插入记录
   * @param {?string} successorRecordId - 后继记录 id；null 表示链尾
   * @param {import("./operation.js").OperationRecord[]} records - 新记录
   * @returns {{diverge: number, removed: import("./operation.js").OperationRecord[], added: import("./operation.js").OperationRecord[]}} 链变化
   */
  insertBefore(successorRecordId, records) {
    const diverge = successorRecordId === null ? this.size : this.#rank(successorRecordId);
    if (records.length === 0) return { diverge, removed: [], added: [] };
    const removed = this.#slice(diverge, this.size);
    const added = [...records, ...removed];
    this.#replaceSuffix(diverge, removed, added);
    return { diverge, removed, added };
  }

  /**
   * 删除一段连续记录
   * @param {string[]} recordIds - 待删除记录 id
   * @returns {{diverge: number, removed: import("./operation.js").OperationRecord[], added: import("./operation.js").OperationRecord[]}} 链变化
   */
  remove(recordIds) {
    if (recordIds.length === 0) return { diverge: this.size, removed: [], added: [] };
    const diverge = this.#rank(recordIds[0]);
    const actual = this.#slice(diverge, diverge + recordIds.length).map((record) => record.id);
    if (actual.some((id, index) => id !== recordIds[index])) {
      throw new Error(`活动链删除目标不连续：期望 ${recordIds.join(",")}，实际 ${actual.join(",")}`);
    }
    const removed = this.#slice(diverge, this.size);
    const deleted = new Set(recordIds);
    const added = removed.filter((record) => !deleted.has(record.id));
    this.#replaceSuffix(diverge, removed, added);
    return { diverge, removed, added };
  }

  /**
   * 以完整新序列替换当前序列
   * @param {import("./operation.js").OperationRecord[]} records - 新序列
   * @returns {{diverge: number, removed: import("./operation.js").OperationRecord[], added: import("./operation.js").OperationRecord[]}} 链变化
   */
  replace(records) {
    const current = this.toArray();
    let diverge = 0;
    while (
      diverge < current.length &&
      diverge < records.length &&
      current[diverge].id === records[diverge].id
    ) {
      diverge += 1;
    }
    const removed = current.slice(diverge);
    const added = records.slice(diverge);
    this.#replaceSuffix(diverge, removed, added);
    return { diverge, removed, added };
  }

  /**
   * 导出活动记录序列
   * @returns {import("./operation.js").OperationRecord[]} 记录数组
   */
  toArray() {
    return this.#slice(0, this.size);
  }

  /**
   * 读取记录位置
   * @param {string} recordId - 记录 id
   * @returns {number} 从零开始的位置
   * @private
   */
  #rank(recordId) {
    let node = this.#byId.get(recordId);
    if (node === undefined) throw new Error(`活动链记录不存在：${recordId}`);
    let rank = sizeOf(node.left);
    while (node.parent !== null) {
      if (node === node.parent.right) {
        rank += sizeOf(node.parent.left) + 1;
      }
      node = node.parent;
    }
    return rank;
  }

  /**
   * 导出区间记录
   * @param {number} start - 起始位置（含）
   * @param {number} end - 结束位置（不含）
   * @returns {import("./operation.js").OperationRecord[]} 区间记录
   * @private
   */
  #slice(start, end) {
    const output = [];
    const walk = (node, offset) => {
      if (node === null || offset + node.size <= start || offset >= end) return;
      const leftSize = sizeOf(node.left);
      walk(node.left, offset);
      const index = offset + leftSize;
      if (index >= start && index < end) output.push(node.record);
      walk(node.right, index + 1);
    };
    walk(this.#root, 0);
    return output;
  }

  /**
   * 替换链后缀
   * @param {number} diverge - 公共前缀长度
   * @param {import("./operation.js").OperationRecord[]} removed - 旧后缀
   * @param {import("./operation.js").OperationRecord[]} added - 新后缀
   * @returns {void}
   * @private
   */
  #replaceSuffix(diverge, removed, added) {
    const [prefix] = this.#split(this.#root, diverge);
    for (const record of removed) this.#byId.delete(record.id);
    let suffix = null;
    for (const record of added) {
      if (this.#byId.has(record.id)) throw new Error(`活动链记录重复：${record.id}`);
      const node = createNode(record);
      this.#update(node);
      suffix = this.#merge(suffix, node);
      this.#byId.set(record.id, node);
    }
    this.#root = this.#merge(prefix, suffix);
    if (this.#root !== null) this.#root.parent = null;
  }

  /**
   * 按序列位置拆分
   * @param {?Object} node - 当前子树
   * @param {number} count - 左子树记录数
   * @returns {[?Object, ?Object]} 左右两棵树
   * @private
   */
  #split(node, count) {
    if (node === null) return [null, null];
    const leftSize = sizeOf(node.left);
    if (count <= leftSize) {
      const [left, right] = this.#split(node.left, count);
      node.left = right;
      if (right !== null) right.parent = node;
      node.parent = null;
      this.#update(node);
      if (left !== null) left.parent = null;
      return [left, node];
    }
    const [left, right] = this.#split(node.right, count - leftSize - 1);
    node.right = left;
    if (left !== null) left.parent = node;
    node.parent = null;
    this.#update(node);
    if (right !== null) right.parent = null;
    return [node, right];
  }

  /**
   * 合并两个保序子树
   * @param {?Object} left - 左子树
   * @param {?Object} right - 右子树
   * @returns {?Object} 合并后的根
   * @private
   */
  #merge(left, right) {
    if (left === null) {
      if (right !== null) right.parent = null;
      return right;
    }
    if (right === null) {
      left.parent = null;
      return left;
    }
    if (comparePriority(left, right) >= 0) {
      const merged = this.#merge(left.right, right);
      left.right = merged;
      if (merged !== null) merged.parent = left;
      left.parent = null;
      this.#update(left);
      return left;
    }
    const merged = this.#merge(left, right.left);
    right.left = merged;
    if (merged !== null) merged.parent = right;
    right.parent = null;
    this.#update(right);
    return right;
  }

  /**
   * 刷新节点聚合值
   * @param {Object} node - 节点
   * @returns {void}
   * @private
   */
  #update(node) {
    node.size = sizeOf(node.left) + sizeOf(node.right) + 1;
    node.hash = hashString(canonicalJson([
      node.left?.hash ?? null,
      node.record.id,
      node.right?.hash ?? null,
      node.size,
    ]));
  }
}

export { ActiveChainIndex };
