/**
 * @module active-object-manager
 */

const { randomNumberPool } = require("../../utils/algorithm");
const { Queue } = require("../../utils/queue");
const { DirectedGraph, NodeNotExistError } = require("../utils/directed-graph");
const { PageManager } = require("./page-manager");

/**
 * 全局活动对象管理器
 * @class
 * @author Zhou Chenyu
 */
class ActiveObjectManager {
  /**
   * 活动对象所构成的动态图
   * @type {DirectedGraph}
   */
  activeGraph;

  /**
   * @type {randomNumberPool}
   */
  layerPool;

  /**
   * 对象到层的映射
   * @type {Map<number, number>}
   */
  onLayer;

  /**
   * 层与层间的顺序
   * @type {number[]}
   */
  layerOrder;

  constructor() {
    this.activeGraph = new DirectedGraph();
    this.layerPool = new randomNumberPool(1, 10000000);
    this.layerOrder = new Array();
    this.onLayer = new Map();
  }

  /**
   * 获取某层对应的 A 虚点的 id
   * @description [tier-graph-document.md](./tier-graph-document.md)
   * @param {number} layerId - 层 id
   * @returns {number} A 虚点 id
   */
  getAPointForLayer(layerId) {
    return -layerId * 2;
  }

  /**
   * 获取某层对应的 B 虚点的 id
   * @description [tier-graph-document.md](./tier-graph-document.md)
   * @param {number} layerId - 层 id
   * @returns {number} B 虚点 id
   */
  getBPointForLayer(layerId) {
    return -layerId * 2 + 1;
  }

  /**
   * 获取虚点对应的层的 id
   * @description [tier-graph-document.md](./tier-graph-document.md)
   * @param {number} layerId - A 虚点或 B 虚点 id
   * @returns {number} 层 id
   */
  getLayerByVirtualPoint(pointId) {
    return pointId % 2 == 0 ? -(pointId / 2) : -((pointId - 1) / 2);
  }

  /**
   *
   * @param {number} obj - 作为起点的对象 id
   * @param {PageManager} pge - 该对象所在的页
   * @returns {{graph: DirectedGraph, layer: number}}
   * @throws {NodeNotExistError} 当对象不存在
   * @private
   * @todo 暂不支持跨页
   */
  pickupGraph(obj, pge) {
    let tier = pge.objectTier;
    let graph = tier.staticGraph;
    if (!graph.hasNode(obj)) {
      throw new NodeNotExistError(obj);
    }

    /**
     * DFS 递归构建子图
     * @param {number} now - 当前所在的节点
     */
    function pickup(now) {}

    const visit = new Set();
    const q = new Queue();
    q.push(obj);
    visit.add(obj);
    const activeGraph = new DirectedGraph();
    activeGraph.addNode(obj);
    const layer = this.layerPool.generate();
    const aPoint = this.getAPointForLayer(layer);
    const bPoint = this.getBPointForLayer(layer);
    activeGraph.addNodeUnsafe(aPoint);
    activeGraph.addNodeUnsafe(bPoint);

    while (!q.empty()) {
      const node = q.pop();
      const neighbors = graph.neighborsUnsafe(node);
      if (neighbors) {
        for (const next of neighbors) {
          if (!visit.has(next)) {
            visit.add(next);
            activeGraph.addNodeUnsafe(next);
            q.push(next);
          }
          activeGraph.addEdgeUnsafe(node, next);
        }
      } else {
        activeGraph.addEdgeUnsafe(node, bPoint);
      }
    }

    let neighbors = graph.neighborsUnsafe(obj);
    activeGraph.addEdgeUnsafe(obj, aPoint);
    if (neighbors) {
      for (const next of neighbors) {
        activeGraph.deleteEdgeUnsafe(obj, next);
        activeGraph.addEdgeUnsafe(aPoint, next);
      }
    }

    return { graph: activeGraph, layer: layer };
  }

  /**
   * @param {number[]} arr - 要选择的对象 id 的数组
   * @param {PageManager[]} pges - 静态图
   */
  choose(arr, pges) {
    if (arr.length === 1) {
      let g = this.pickupGraph(arr[0], pges[0]);
      // [todo]
      this.activeGraph = g;
    }
  }
}

module.exports = {
  ActiveObjectManager,
};
