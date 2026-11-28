/**
 * @file 白板应然层序投影
 * @description 以纯快照几何维护活动记录的覆盖区块、静态层叠图和增量层序摘要。
 * @module kernel/projection/derived-layer-projection
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { OPERATION_TYPES } from "../hit/operation.js";
import { DirectedGraph } from "../utils/directed-graph.js";
import { HashTrie } from "../utils/hash-trie.js";
import { getSerializedObjectWorldRect } from "../objects/object-geometry.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { intersectsRanges } from "../range/index.js";
import { addLayerEdgeIfAcyclic, hashLayerGraph } from "../board/layer-edges.js";

/**
 * 白板应然层序投影
 * @class
 * @author Zhou Chenyu
 */
class DerivedLayerProjection {
  /**
   * 区块边长
   * @type {number}
   * @private
   */
  #width;

  /**
   * 区块边长
   * @type {number}
   * @private
   */
  #height;

  /**
   * 读取当前对象快照
   * @type {(id: string) => Object|undefined}
   * @private
   */
  #getSnapshot;

  /**
   * 各区块静态图
   * @type {Map<number, DirectedGraph<string>>}
   * @private
   */
  #graphs = new Map();

  /**
   * 对象覆盖区块索引
   * @type {Map<string, Set<number>>}
   * @private
   */
  #cover = new Map();

  /**
   * 层序哈希索引
   * @type {HashTrie}
   * @private
   */
  #layerHashes = new HashTrie();

  /**
   * 构造层序投影
   * @param {{width: number, height: number, getSnapshot: (id: string) => Object|undefined}} options - 几何与快照来源
   */
  constructor({ width, height, getSnapshot }) {
    this.#width = width;
    this.#height = height;
    this.#getSnapshot = getSnapshot;
  }

  /**
   * 层序根哈希
   * @type {string}
   */
  get layerHash() {
    return this.#layerHashes.rootHash;
  }

  /**
   * 层序哈希索引
   * @returns {HashTrie} 哈希索引
   */
  getLayerHashes() {
    return this.#layerHashes;
  }

  /**
   * 读取区块静态图
   * @param {number} chunkId - 区块 id
   * @returns {DirectedGraph<string>|undefined} 静态图
   */
  getGraph(chunkId) {
    return this.#graphs.get(Number(chunkId));
  }

  /**
   * 导出全部区块静态图
   * @returns {Array<[number, DirectedGraph<string>]>} 图表条目
   */
  getGraphEntries() {
    return [...this.#graphs.entries()];
  }

  /**
   * 读取对象覆盖区块
   * @param {string} objectId - 对象 id
   * @returns {Set<number>} 覆盖区块集合
   */
  getCoverChunks(objectId) {
    return new Set(this.#cover.get(objectId) ?? []);
  }

  /**
   * 清空全部层序状态
   * @returns {void}
   */
  reset() {
    this.#graphs = new Map();
    this.#cover = new Map();
    this.#layerHashes = new HashTrie();
  }

  /**
   * 正放一条记录的层序效果
   * @param {import("../hit/operation.js").OperationRecord} record - 操作记录
   * @param {string} previousLocation - 应用前对象位置
   * @returns {void}
   */
  apply(record, previousLocation) {
    const { type, payload } = record;
    switch (type) {
      case OPERATION_TYPES.ADD_OBJECT:
        if (previousLocation !== "objects") this.#add(payload);
        return;
      case OPERATION_TYPES.MODIFY_OBJECT:
        if (previousLocation === "objects") this.#modify(payload, "after");
        return;
      case OPERATION_TYPES.DELETE_OBJECT:
        this.#remove(payload.objectId);
        return;
      case OPERATION_TYPES.UNCHOOSE_OBJECT:
        if (payload.chunks !== undefined) {
          this.#applyRecordedEdges(payload.objectId, payload.chunks);
          this.#stitch(payload.objectId, payload.chunks, "above");
        }
        return;
      default:
        return;
    }
  }

  /**
   * 逆放一条记录的层序效果
   * @param {import("../hit/operation.js").OperationRecord} record - 操作记录
   * @param {string} previousLocation - 逆放前对象位置
   * @returns {void}
   */
  revert(record, previousLocation) {
    const { type, payload } = record;
    switch (type) {
      case OPERATION_TYPES.ADD_OBJECT:
        this.#remove(payload.objectId);
        return;
      case OPERATION_TYPES.MODIFY_OBJECT:
        if (previousLocation === "objects") this.#modify(payload, "before");
        return;
      case OPERATION_TYPES.DELETE_OBJECT:
        if (previousLocation === "trash") this.#restore(payload.objectId, payload.chunks);
        return;
      case OPERATION_TYPES.CHOOSE_OBJECT:
        if (payload.chunks !== undefined) {
          this.#applyRecordedEdges(payload.objectId, payload.chunks);
          this.#stitch(payload.objectId, payload.chunks, "below");
        }
        return;
      default:
        return;
    }
  }

  /**
   * 应用增加对象效果
   * @param {Object} payload - 增加对象载荷
   * @returns {void}
   * @private
   */
  #add(payload) {
    const rect = this.#rect(payload.objectId);
    if (!rect) return;
    const covered = ChunkObjectManager.calculateCoveredChunkIdsForRange(rect, this.#width, this.#height);
    this.#cover.set(payload.objectId, new Set(covered));
    for (const chunkId of covered) {
      const graph = this.#ensureGraph(chunkId);
      const below = payload.chunks === undefined
        ? graph.getNodes().filter((id) => this.#intersects(payload.objectId, id, rect))
        : [];
      if (!graph.hasNode(payload.objectId)) graph.addNodeUnsafe(payload.objectId);
      for (const id of below) addLayerEdgeIfAcyclic(graph, id, payload.objectId);
      this.#syncGraph(chunkId);
    }
    if (payload.chunks !== undefined) {
      this.#applyRecordedEdges(payload.objectId, payload.chunks);
      this.#stitch(payload.objectId, payload.chunks, "above");
    }
  }

  /**
   * 应用或逆放修改对象效果
   * @param {Object} payload - 修改对象载荷
   * @param {"before"|"after"} direction - 快照方向
   * @returns {void}
   * @private
   */
  #modify(payload, direction) {
    this.#syncMembership(payload.objectId);
    const chunks = payload.chunks?.[direction];
    if (chunks !== undefined) {
      this.#applyRecordedEdges(payload.objectId, chunks);
      this.#stitch(payload.objectId, chunks, direction === "after" ? "above" : "below");
    }
  }

  /**
   * 从全部静态图移除对象
   * @param {string} objectId - 对象 id
   * @returns {void}
   * @private
   */
  #remove(objectId) {
    const touched = new Set(this.#cover.get(objectId) ?? []);
    for (const [chunkId, graph] of this.#graphs) {
      if (graph.hasNode(objectId)) {
        graph.deleteNodeUnsafe(objectId);
        touched.add(chunkId);
      }
    }
    this.#cover.delete(objectId);
    for (const chunkId of touched) this.#syncGraph(chunkId);
  }

  /**
   * 恢复删除对象的层位边
   * @param {string} objectId - 对象 id
   * @param {Array} chunks - 删除时层位边
   * @returns {void}
   * @private
   */
  #restore(objectId, chunks) {
    this.#applyRecordedEdges(objectId, chunks);
    this.#stitch(objectId, chunks, "below");
  }

  /**
   * 按记录重写主体边
   * @param {string} objectId - 主体对象 id
   * @param {Array} chunks - 记录层位边
   * @returns {void}
   * @private
   */
  #applyRecordedEdges(objectId, chunks) {
    const touched = new Set();
    for (const entry of chunks ?? []) {
      const chunkId = Number(entry.chunkId);
      const graph = this.#ensureGraph(chunkId);
      if (!graph.hasNode(objectId)) graph.addNodeUnsafe(objectId);
      graph.deleteAllEdgesOfNode(objectId);
      for (const id of entry.below ?? []) addLayerEdgeIfAcyclic(graph, id, objectId);
      for (const id of entry.above ?? []) addLayerEdgeIfAcyclic(graph, objectId, id);
      touched.add(chunkId);
    }
    if (touched.size > 0) {
      const covered = new Set(this.#cover.get(objectId) ?? []);
      for (const chunkId of touched) covered.add(chunkId);
      this.#cover.set(objectId, covered);
    }
    for (const chunkId of touched) this.#syncGraph(chunkId);
  }

  /**
   * 缝合记录之外的相交对象
   * @param {string} objectId - 主体对象 id
   * @param {Array} chunks - 记录层位边
   * @param {"above"|"below"} position - 主体相对方位
   * @returns {void}
   * @private
   */
  #stitch(objectId, chunks, position) {
    const rect = this.#rect(objectId);
    if (!rect) return;
    for (const entry of chunks ?? []) {
      const chunkId = Number(entry.chunkId);
      const graph = this.#graphs.get(chunkId);
      if (!graph?.hasNode(objectId)) continue;
      const recorded = new Set([...(entry.below ?? []), ...(entry.above ?? [])]);
      let changed = false;
      for (const nodeId of graph.getNodes()) {
        if (nodeId === objectId || recorded.has(nodeId)) continue;
        if (!this.#intersects(objectId, nodeId, rect)) continue;
        const [from, to] = position === "above" ? [nodeId, objectId] : [objectId, nodeId];
        if (addLayerEdgeIfAcyclic(graph, from, to)) changed = true;
      }
      if (changed) this.#syncGraph(chunkId);
    }
  }

  /**
   * 按当前几何同步对象覆盖区块
   * @param {string} objectId - 对象 id
   * @returns {void}
   * @private
   */
  #syncMembership(objectId) {
    const rect = this.#rect(objectId);
    if (!rect) return;
    const next = ChunkObjectManager.calculateCoveredChunkIdsForRange(rect, this.#width, this.#height);
    if (next.size === 0) return;
    const previous = this.#cover.get(objectId) ?? new Set();
    for (const chunkId of previous) {
      if (next.has(chunkId)) continue;
      const graph = this.#graphs.get(chunkId);
      if (graph?.hasNode(objectId)) graph.deleteNodeUnsafe(objectId);
      this.#syncGraph(chunkId);
    }
    for (const chunkId of next) {
      const graph = this.#ensureGraph(chunkId);
      if (graph.hasNode(objectId)) {
        this.#syncGraph(chunkId);
        continue;
      }
      const below = graph.getNodes().filter((id) => this.#intersects(objectId, id, rect));
      graph.addNodeUnsafe(objectId);
      for (const id of below) addLayerEdgeIfAcyclic(graph, id, objectId);
      this.#syncGraph(chunkId);
    }
    this.#cover.set(objectId, new Set(next));
  }

  /**
   * 读取对象世界包围矩形
   * @param {string} objectId - 对象 id
   * @returns {import("../range/index.js").RectangleRange|null} 世界包围矩形
   * @private
   */
  #rect(objectId) {
    const snapshot = this.#getSnapshot(objectId);
    return snapshot ? getSerializedObjectWorldRect(snapshot) : null;
  }

  /**
   * 判断两个对象是否相交
   * @param {string} objectId - 主体对象 id
   * @param {string} otherId - 另一对象 id
   * @param {import("../range/index.js").RectangleRange} rect - 主体矩形
   * @returns {boolean} 是否相交
   * @private
   */
  #intersects(objectId, otherId, rect) {
    if (objectId === otherId) return false;
    const otherRect = this.#rect(otherId);
    return otherRect ? intersectsRanges(rect, otherRect) : false;
  }

  /**
   * 取得或创建区块静态图
   * @param {number} chunkId - 区块 id
   * @returns {DirectedGraph<string>} 静态图
   * @private
   */
  #ensureGraph(chunkId) {
    let graph = this.#graphs.get(chunkId);
    if (graph === undefined) {
      graph = new DirectedGraph();
      this.#graphs.set(chunkId, graph);
    }
    return graph;
  }

  /**
   * 同步单个区块的图哈希
   * @param {number} chunkId - 区块 id
   * @returns {void}
   * @private
   */
  #syncGraph(chunkId) {
    const graph = this.#graphs.get(chunkId);
    if (!graph || graph.getNodes().length === 0) {
      this.#graphs.delete(chunkId);
      this.#layerHashes.delete(String(chunkId));
      return;
    }
    this.#layerHashes.set(String(chunkId), hashLayerGraph(graph));
  }
}

export { DerivedLayerProjection };
