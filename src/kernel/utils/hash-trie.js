/**
 * @file 增量哈希基数树
 * @description 以固定深度基数树维护键值哈希，支持常数深度更新与只沿分歧路径的键定位。
 * @module kernel/utils/hash-trie
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { canonicalJson } from "./canonical-json.js";
import { hashString } from "./hash.js";

/** 哈希路径的十六进制字符数。 */
const HASH_PATH_DEPTH = 8;

/**
 * 创建内部节点或叶子节点
 * @param {number} depth - 节点深度
 * @returns {{children: Map<string, Object>, entries: ?Map<string, string>, hash: string}} 节点
 * @private
 */
function createNode(depth) {
  const node = {
    children: new Map(),
    entries: depth === HASH_PATH_DEPTH ? new Map() : null,
    hash: "",
  };
  node.hash = hashNode(node);
  return node;
}

/**
 * 计算节点摘要
 * @param {{children: Map<string, Object>, entries: ?Map<string, string>}} node - 节点
 * @returns {string} 节点哈希
 * @private
 */
function hashNode(node) {
  if (node.entries !== null) {
    return hashString(`L${canonicalJson([...node.entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))}`);
  }
  const children = [...node.children]
    .map(([key, child]) => [key, child.hash])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return hashString(`N${canonicalJson(children)}`);
}

/**
 * 收集子树中的全部键
 * @param {Object} node - 当前节点
 * @param {string[]} output - 输出数组
 * @returns {void}
 * @private
 */
function collectKeys(node, output) {
  if (node.entries !== null) {
    output.push(...node.entries.keys());
    return;
  }
  for (const child of node.children.values()) {
    collectKeys(child, output);
  }
}

/**
 * 增量哈希基数树
 * @description 键经 FNV-1a 映射到八层十六进制路径，叶子保存完整键以避免路径碰撞造成身份混淆。
 * @class
 * @author Zhou Chenyu
 */
class HashTrie {
  /**
   * 根节点
   * @type {Object}
   * @private
   */
  #root = createNode(0);

  /**
   * 根哈希
   * @type {string}
   */
  get rootHash() {
    return this.#root.hash;
  }

  /**
   * 读取键对应的值哈希
   * @param {string} key - 完整键
   * @returns {string|undefined} 值哈希；不存在时为 undefined
   */
  get(key) {
    const path = this.#locate(key);
    return path.leaf?.entries.get(key);
  }

  /**
   * 写入键值哈希
   * @param {string} key - 完整键
   * @param {string} valueHash - 值哈希
   * @returns {void}
   */
  set(key, valueHash) {
    if (this.get(key) === valueHash) return;
    const path = this.#locate(key, true);
    path.leaf.entries.set(key, valueHash);
    this.#rehash(path);
  }

  /**
   * 删除键
   * @param {string} key - 完整键
   * @returns {void}
   */
  delete(key) {
    const path = this.#locate(key);
    if (path.leaf === null || !path.leaf.entries.has(key)) return;
    path.leaf.entries.delete(key);
    for (let depth = HASH_PATH_DEPTH; depth > 0; depth -= 1) {
      const node = path.nodes[depth];
      const isEmpty = node.entries === null
        ? node.children.size === 0
        : node.entries.size === 0;
      if (!isEmpty) break;
      path.nodes[depth - 1].children.delete(path.parts[depth - 1]);
    }
    this.#rehash(path);
  }

  /**
   * 找出两棵树中值不同的完整键
   * @param {HashTrie} other - 另一棵树
   * @returns {string[]} 排序后的分歧键
   */
  diffKeys(other) {
    if (!(other instanceof HashTrie) || this.rootHash === other.rootHash) return [];
    const keys = new Set();
    const walk = (left, right) => {
      if (left?.hash === right?.hash) return;
      if (left === undefined || right === undefined) {
        const collected = [];
        collectKeys(left ?? right, collected);
        for (const key of collected) keys.add(key);
        return;
      }
      if (left.entries !== null && right.entries !== null) {
        for (const key of new Set([...left.entries.keys(), ...right.entries.keys()])) {
          if (left.entries.get(key) !== right.entries.get(key)) keys.add(key);
        }
        return;
      }
      for (const part of new Set([...left.children.keys(), ...right.children.keys()])) {
        walk(left.children.get(part), right.children.get(part));
      }
    };
    walk(this.#root, other.#root);
    return [...keys].sort();
  }

  /**
   * 定位键对应的叶子路径
   * @param {string} key - 完整键
   * @param {boolean} [create=false] - 是否创建缺失路径
   * @returns {{nodes: Object[], parts: string[], leaf: ?Object}} 路径；未创建且缺失时 leaf 为 null
   * @private
   */
  #locate(key, create = false) {
    const parts = hashString(key).split("");
    const nodes = [this.#root];
    let current = this.#root;
    for (let depth = 0; depth < HASH_PATH_DEPTH; depth += 1) {
      const part = parts[depth];
      let next = current.children.get(part);
      if (next === undefined) {
        if (!create) return { nodes, parts, leaf: null };
        next = createNode(depth + 1);
        current.children.set(part, next);
      }
      nodes.push(next);
      current = next;
    }
    return { nodes, parts, leaf: current };
  }

  /**
   * 自叶向根刷新路径摘要
   * @param {{nodes: Object[]}} path - 节点路径
   * @returns {void}
   * @private
   */
  #rehash(path) {
    for (let depth = path.nodes.length - 1; depth >= 0; depth -= 1) {
      path.nodes[depth].hash = hashNode(path.nodes[depth]);
    }
  }
}

export { HashTrie };
