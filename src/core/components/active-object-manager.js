/**
 * @module active-object-manager
 */

const { RandomNumberPool } = require("../../utils/algorithm");
const { Queue } = require("../../utils/queue");
const { CounterPool } = require("../utils/counter-pool");
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
   * @type {RandomNumberPool}
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
    this.layerPool = new RandomNumberPool(1, 10000000);
    this.layerOrder = [];
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
   * @param {number} pointId - A 虚点或 B 虚点 id
   * @returns {number} 层 id
   */
  getLayerByVirtualPoint(pointId) {
    return pointId % 2 === 0 ? -(pointId / 2) : -((pointId - 1) / 2);
  }

  /**
   * @description 内部使用 BFS 来遍历图，跨页对象（尤其是反复横跳的）会造成较大的性能损失
   * @param {number} obj - 作为起点的对象 id
   * @param {PageManager} pge - 该对象所在的页
   * @returns {DirectedGraph}
   * @private
   * @todo 暂不支持跨页
   */
  pickupSingle(obj, pge) {
    let tier = pge.objectTier;
    let graph = tier.staticGraph;

    const q = new Queue();
    const visit = new Set();
    const activeGraph = new DirectedGraph();
    q.push(obj);
    visit.add(obj);
    activeGraph.addNodeUnsafe(obj);

    // BFS 遍历
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
      }
    }

    return activeGraph;
  }

  /**
   * @description 内部使用 BFS 来遍历图，跨页对象（尤其是反复横跳的）会造成较大的性能损失
   * @param {number[]} obj - 作为起点的对象 id 们
   * @param {PageManager} pge - 对象所在的页，当前只能处理在同一页的对象
   * @returns {DirectedGraph}
   * @private
   * @todo 暂不支持跨页
   */
  pickupMulti(objs, pge) {
    let tier = pge.objectTier;
    let graph = tier.staticGraph;

    const q = new Queue();
    const visit = new Set();
    const activeGraph = new DirectedGraph();
    for (const obj of objs) {
      q.push(obj);
      visit.add(obj);
      activeGraph.addNodeUnsafe(obj);
    }

    // BFS 遍历
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
      }
    }

    return activeGraph;
  }

  /**
   * @param {number[]} arr - 要选择的对象 id 的数组
   * @param {PageManager[]} pges - 静态图
   */
  choose(arr, pges) {
    if (arr.length === 1) {
      let g = this.pickupSingle(arr[0], pges[0]);
      // [todo] activeGraph 不能直接等于 g，而应进行处理
      this.activeGraph = g;
    } else {
      // [todo] 现在不能选跨页的多个对象
      let g = this.pickupMulti(arr, pges[0]);
      // [todo] activeGraph 不能直接等于 g，而应进行处理
      this.activeGraph = g;
    }
  }

  /**
   * 在顶端添加一个对象
   * @param {number} obj - 对象 id
   */
  addTopObj(obj) {}
}

module.exports = {
  ActiveObjectManager,
};
