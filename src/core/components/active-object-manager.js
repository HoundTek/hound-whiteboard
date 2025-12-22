/**
 * 全局活动对象管理器
 * @module active-object-manager
 * @author Zhou Chenyu
 */

const { RandomNumberPool } = require("../../utils/algorithm");
const { Deque } = require("../../utils/deque");
const { Queue } = require("../../utils/queue");
const { CounterPool } = require("../utils/counter-pool");
const { DirectedGraph } = require("../utils/directed-graph");
const { PageManager } = require("./page-manager");

/**
 * 全局活动对象管理器
 * @class
 * @author Zhou Chenyu
 */
class ActiveObjectManager {
  /**
   * 活动对象所构成的动态图
   * @description 见 [tier-graph-document.md](./tier-graph-document.md)。
   * 不能有环，不能有重复的对象 id。
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

  /**
   * 层的索引
   * @type {Map<number, number>}
   */
  layerIndex;

  constructor() {
    this.activeGraph = new DirectedGraph();
    this.layerPool = new RandomNumberPool(1, 10000000);
    this.layerOrder = [];
    this.onLayer = new Map();
    this.layerIndex = new Map();
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
   * 获取以指定对象集合为起点的子图
   * @description 内部使用 BFS 来遍历图，跨页对象（尤其是反复横跳的）会造成较大的性能损失
   * @param {number[]} objs - 作为起点的对象 id 数组
   * @param {PageManager[]} pges - 该对象所在的页，为 `PageManager` 实例数组
   * @returns {DirectedGraph}
   * @private
   */
  pickup(objs, pges) {
    const visit = new Set();
    const graph = new DirectedGraph();

    /**
     * @param {number} obj - 要拾取的对象 id
     * @param {PageManager} pge - 该对象所在的页
     */
    function pickupSingle(obj, pge) {
      if (visit.has(obj)) return;
      visit.add(obj);
      graph.addNodeUnsafe(obj);

      let pageLoader = new PageLoadManager();
      // 初始化页加载器，预加载当前页
      pageLoader.resetCurrentPage(pge);

      /**
       * DFS 遍历
       * @description 由于我们的图是薄薄的一层水，所以此处 DFS 不必担心栈溢出的问题。
       * @param {number} node - 对象 id
       */
      function dfs(node) {
        const neighbors =
          pageLoader.pageNow.objectManager.staticGraph.neighborsUnsafe(node);

        // 该页对象
        if (neighbors) {
          for (const next of neighbors) {
            if (!visit.has(next)) {
              visit.add(next);
              graph.addNodeUnsafe(next);
              dfs(next);
            }
            graph.addEdgeUnsafe(node, next);
          }
        }

        // 跨左页
        if (tier.coverLeftPage.has(node)) {
          pageLoader.moveToLeft();
          const neighbors =
            pageLoader.pageNow.objectManager.staticGraph.neighborsUnsafe(node);
          if (neighbors) {
            for (const next of neighbors) {
              if (!visit.has(next)) {
                visit.add(next);
                graph.addNodeUnsafe(next);
                dfs(next);
              }
              graph.addEdgeUnsafe(node, next);
            }
          }
          pageLoader.moveToRight();
        }

        // 跨右页
        if (tier.coverRightPage.has(node)) {
          pageLoader.moveToRight();
          const neighbors =
            pageLoader.pageNow.objectManager.staticGraph.neighborsUnsafe(node);
          if (neighbors) {
            for (const next of neighbors) {
              if (!visit.has(next)) {
                visit.add(next);
                graph.addNodeUnsafe(next);
                dfs(next);
              }
              graph.addEdgeUnsafe(node, next);
            }
          }
          pageLoader.moveToLeft();
        }
      }

      dfs(obj);
    }

    for (let i = 0; i < objs.length; i++) {
      pickupSingle(objs[i], pges[i]);
    }

    return graph;
  }

  /**
   * @param {number[]} objs - 要选择的对象 id 的数组
   * @param {PageManager[]} pges - 这些对象所在的页
   * @todo
   */
  choose(objs, pges) {
    if (objs.length === 1) {
      let graph = this.pickup(objs, pges);
      // [todo] activeGraph 不能直接等于 graph，而应进行处理
      // - 加入层的虚点
      // - 删除重复点
      // - 依据层次关系插入 graph
      // - see tier-graph-document.md
      this.activeGraph = graph;
    } else {
      // [todo] 现在不能选跨页的多个对象
      let graph = this.pickup(objs, pges);
      // [todo] activeGraph 不能直接等于 graph，而应进行处理
      // - 加入层的虚点
      // - 删除重复点
      // - 依据层次关系插入 graph
      // - see tier-graph-document.md
      this.activeGraph = graph;
    }
  }

  /**
   * 在顶端添加一个或多个对象
   * @description 这些对象不能有交集。
   * 用于置顶、粘贴、添加新对象等
   * @param {number[]} objs - 要添加的对象
   */
  addObjectsToTop(objs) {
    // 分配一个新层
    let layer = this.layerPool.generate();
    this.layerOrder.push(layer);
    for (const obj of objs) {
      if (this.onLayer.has(obj)) {
        // [todo] 移去原有的对象
        throw new Error(
          `Object ${obj} already on layer ${this.onLayer.get(obj)}`
        );
      }
      this.activeGraph.addNodeUnsafe(obj);
      this.onLayer.set(obj, layer);
    }

    // 在动态图中添加虚点和边
    let aPoint = this.getAPointForLayer(layer);
    this.activeGraph.addNodeUnsafe(aPoint);
    let bPoint = this.getBPointForLayer(layer);
    this.activeGraph.addNodeUnsafe(bPoint);
    this.activeGraph.addEdgeUnsafe(aPoint, bPoint);
    for (const obj of objs) {
      this.activeGraph.addEdgeUnsafe(obj, aPoint);
    }

    // 连接该层与上一层
    if (this.layerOrder.length > 1) {
      let prevLayer = this.layerOrder[this.layerOrder.length - 2];
      let prevBPoint = this.getBPointForLayer(prevLayer);
      this.activeGraph.addEdgeUnsafe(prevBPoint, aPoint);
    }
  }

  /**
   * 将某层移动到另一层之下
   * @description 该方法不会断开 layerNow 与上下层的连接，请在调用前后自行处理。
   * @param {number} layerNow - 要移动的层
   * @param {number | undefined} [layerAbove = undefined] - 要移动到何层之下，若未指定则移至顶层
   */
  insertLayerUnder(layerNow, layerAbove = undefined) {
    // 确定 layerBelow
    let layerBelow;
    if (layerAbove) {
      let indexAbove = this.layerIndex.get(layerAbove);
      if (indexAbove == 0) {
        layerBelow = undefined;
      } else if (indexAbove != -1) {
        layerBelow = this.layerOrder[indexAbove - 1];
      } else {
        throw new Error(`Layer ${layerAbove} is not exist.`);
      }
    } else {
      layerBelow = this.layerOrder[this.layerOrder.length - 1];
    }

    // 图示说明：
    // ... --> Bp . -+> activen1 -+> An --> ... --> Bn . -+> actives1 -+> As --> ...
    //            .  |            |                    .  |            |
    //            .  +> activen2 -+                    .  +> actives2 -+
    //            .  |                                 .  |
    //            .  ...                               .  ...
    //            .                                    .
    //  layerPre  .              layerNow              .          layerSuc

    // 与其下层连接
    if (layerBelow) {
      let aPointNow = this.getAPointForLayer(layerNow);
      let bPointBelow = this.getBPointForLayer(layerBelow);
      let activeObjs = this.activeGraph.predecessorsUnsafe(aPointNow);
      for (const activeObj of activeObjs) {
        this.activeGraph.addEdgeUnsafe(bPointBelow, activeObj);
      }
    }

    // 与其上层连接
    if (layerAbove) {
      let bPointNow = this.getBPointForLayer(layerNow);
      let aPointAbove = this.getAPointForLayer(layerAbove);
      let activeObjs = this.activeGraph.predecessorsUnsafe(aPointAbove);
      for (const activeObj of activeObjs) {
        this.activeGraph.addEdgeUnsafe(bPointNow, activeObj);
      }
    }

    // 更新 layerOrder 和 layerIndex
    let indexFrom = this.layerIndex.get(layerNow);
    let indexTo = layerAbove
      ? this.layerIndex.get(layerAbove)
      : this.layerOrder.length - 1;
    if (indexFrom < indexTo) {
      // 向前移动
      for (let i = indexFrom; i < indexTo; i++) {
        this.layerOrder[i] = this.layerOrder[i + 1];
        this.layerIndex.set(this.layerOrder[i], i);
      }
      this.layerOrder[indexTo] = layerNow;
      this.layerIndex.set(layerNow, indexTo);
    } else if (indexFrom > indexTo) {
      // 向后移动
      for (let i = indexFrom; i > indexTo; i--) {
        this.layerOrder[i] = this.layerOrder[i - 1];
        this.layerIndex.set(this.layerOrder[i], i);
      }
      this.layerOrder[indexTo] = layerNow;
      this.layerIndex.set(layerNow, indexTo);
    }
  }
}

class PageLoadManager {
  /**
   * 已临时加载的页
   * @description 页数不超过 `pagesLoadedLimit` 页，为页实例引用的双端队列。
   * @type {Deque}
   */
  pagesLoaded;

  /**
   * 当前页
   * @type {PageManager}
   */
  pageNow;

  /**
   * 已加载页数上限
   * @type {number}
   * @default 4
   */
  pagesLoadedLimit;

  /**
   * @param {number} [limit = 4] - 可以加载的页数上限
   */
  constructor(limit = 4) {
    this.pagesLoadedLimit = limit;
    this.pagesLoaded = new Deque();
  }

  /**
   * 重置当前页
   * @param {PageManager} page - 新的当前页
   */
  resetCurrentPage(page) {
    this.pageNow = page;
    // 卸载所有已加载页
    while (this.pagesLoaded.size() > 0) {
      /** @type {PageManager} */
      let pageToUnload = this.pagesLoaded.popFront();
      pageToUnload.objectManager.unloadTiermap();
    }
    // 加载当前页
    this.pagesLoaded = new Deque();
    this.pagesLoaded.pushBack(page);
    page.objectManager.loadTiermap(/* [todo] file */);
  }

  /**
   * 将当前页右移
   * @todo
   */
  moveToRight() {
    // 加载右页
    try {
      this.loadRight();
    } catch (e) {
      throw e;
    }
    // 右移当前页
    this.pageNow = pageToLoad;
  }

  /**
   * 加载右页但不切换当前页
   * @todo
   */
  loadRight() {
    // 卸载多余页
    while (this.pagesLoaded.size() >= this.pagesLoadedLimit) {
      /** @type {PageManager} */
      let pageToUnload = this.pagesLoaded.popFront();
      pageToUnload.objectManager.unloadTiermap();
    }
    // 加载右页
    let pageToLoad = this.pageNow.nextPage;
    if (!pageToLoad) {
      throw new Error("Next page is not exist.");
    }
    if (!pageToLoad.isLoad) {
      pageToLoad.objectManager.loadTiermap(/* [todo] file */);
      this.pagesLoaded.pushBack(pageToLoad);
    }
  }

  /**
   * 将当前页左移
   * @todo
   */
  moveToLeft() {
    // 加载左页
    try {
      this.loadLeft();
    } catch (e) {
      throw e;
    }
    // 左移当前页
    this.pageNow = pageToLoad;
  }

  /**
   * 加载左页但不切换当前页
   * @todo
   */
  loadLeft() {
    // 卸载多余页
    while (this.pagesLoaded.size() >= this.pagesLoadedLimit) {
      /** @type {PageManager} */
      let pageToUnload = this.pagesLoaded.popBack();
      pageToUnload.objectManager.unloadTiermap();
    }
    // 加载左页
    let pageToLoad = this.pageNow.prevPage;
    if (!pageToLoad) {
      throw new Error("Previous page is not exist.");
    }
    if (!pageToLoad.isLoad) {
      pageToLoad.objectManager.loadTiermap(/* [todo] file */);
      this.pagesLoaded.pushFront(pageToLoad);
    }
  }
}

module.exports = {
  ActiveObjectManager,
};
