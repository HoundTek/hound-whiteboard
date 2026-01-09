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

class Layer {
  /**
   * 层 id
   * @type {number}
   */
  id;

  /**
   * 该层上的活动对象 id 集合
   * @type {Set<number>}
   */
  activeObjects;

  /**
   * 该层上的非活动对象子图
   * @type {DirectedGraph}
   */
  inactiveGraph;

  constructor(id) {
    this.id = id;
    this.activeObjects = new Set();
    this.inactiveGraph = new DirectedGraph();
  }
}

/**
 * 全局活动对象管理器
 * @class
 * @author Zhou Chenyu
 */
class ActiveObjectManager {
  /**
   * 层 id 池
   * @type {RandomNumberPool}
   */
  layerPool;

  /**
   * 垃圾对象 id 池
   * @type {CounterPool}
   * @description 用于分配在动态图中被删去的对象的占位 id。
   */
  junkPool;

  /**
   * 新分配一个垃圾对象 id
   * @returns {number} 新分配的垃圾对象 id
   * @private
   */
  newJunkId() {
    return -this.junkPool.generate();
  }

  /**
   * 初始化垃圾对象 id 池
   * @private
   */
  initJunkPool() {
    this.junkPool = new CounterPool(this.layerPool.max + 1);
  }

  /**
   * 对象所在的层
   * @description 对象 id -> 层实例的引用，便于快速查找某对象所在层。
   * @type {Map<number, Layer>}
   */
  onLayer;

  /**
   * 层与层间的顺序
   * @description 层索引 -> 层实例，便于按层次顺序遍历各层。
   * @type {Layer[]}
   */
  layerOrder;

  /**
   * 层在 `layerOrder` 数组中的索引
   * @description 层 id -> 层索引，便于快速查找某层的位置。
   * @type {Map<number, number>}
   */
  layerIndex;

  /**
   * 当前所有活动对象 id 集合
   * @type {Set<number>}
   */
  activeObjects;

  constructor() {
    this.layerPool = new RandomNumberPool(1, 10000000);
    this.initJunkPool();
    this.layerOrder = [];
    this.onLayer = new Map();
    this.layerIndex = new Map();
    this.activeObjects = new Set();
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
        if (pageLoader.pageNow.objectManager.coverLeftPage.has(node)) {
          pageLoader.moveToLeft();
          const neighborsLeft =
            pageLoader.pageNow.objectManager.staticGraph.neighborsUnsafe(node);
          if (neighborsLeft) {
            for (const next of neighborsLeft) {
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
        if (pageLoader.pageNow.objectManager.coverRightPage.has(node)) {
          pageLoader.moveToRight();
          const neighborsRight =
            pageLoader.pageNow.objectManager.staticGraph.neighborsUnsafe(node);
          if (neighborsRight) {
            for (const next of neighborsRight) {
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
      } // function dfs ends here

      dfs(obj);
    } // function pickupSingle ends here

    for (let i = 0; i < objs.length; i++) {
      pickupSingle(objs[i], pges[i]);
    }

    return graph;
  }

  /**
   * @param {number[]} objs - 要选择的对象 id 的数组
   * @param {PageManager[]} pges - 这些对象所在的页
   */
  choose(objs, pges) {
    // 提取出这些对象所构成的子图
    let graph = this.pickup(objs, pges);

    // 获取对象所在层
    let layerIndex = new Map();
    let visit = new Set();
    let queue = new Queue();
    for (const node of graph.getNoIncomingNodes()) {
      visit.add(node);
      queue.push(node);
      layerIndex.set(node, 1);
    }

    while (!queue.empty()) {
      let node = queue.pop();
      let layerNow = layerIndex.get(node);
      for (const next of graph.neighborsUnsafe(node) || []) {
        if (objs.includes(next)) {
          layerIndex.set(
            next,
            Math.max(layerNow + 1, layerIndex.get(next) || 0)
          );
        } else {
          layerIndex.set(next, Math.max(layerNow, layerIndex.get(next) || 0));
        }
        if (!visit.has(next)) {
          visit.add(next);
          queue.push(next);
        }
      }
    }

    // 处理层的上下关系
    let underWhich = Array.from({ length: layerIndex.size }, () => undefined); // 层索引 -> 层索引
    let layers = Array.from(
      { length: layerIndex.size },
      () => new Layer(this.layerPool.generate())
    );
    let duplicates = new Map(); // 记录重复对象，键为对象 id，值为旧层的 id（该对象以前出现在哪一层）
    for (const node of graph.getNodes()) {
      let layer = layerIndex.get(node);
      if (this.activeObjects.has(node)) {
        // 它是以前就有的活动对象
        // 此时该层应在其之下
        if (underWhich[layer - 1]) {
          if (
            this.compareLayerOrder(
              underWhich[layer - 1],
              this.onLayer.get(node).id
            ) > 0
          ) {
            // 如果新层本来应在旧层之上，那么调整为新层应在旧层之下
            underWhich[layer - 1] = this.onLayer.get(node).id;
          }
        } else {
          underWhich[layer - 1] = this.onLayer.get(node).id;
        }
        duplicates.set(node, this.onLayer.get(node).id);
      } else if (this.onLayer.has(node)) {
        // 它以前就有，但不是活动对象
        // 对该层的上下关系无影响
        duplicates.set(node, this.onLayer.get(node).id);
      }
    }

    // 将对象加入层并处理重复对象
    for (const node of graph.getNodes()) {
      let layer = layerIndex.get(node);
      if (duplicates.has(node)) {
        /** @type {Layer} */
        let oldLayer =
          this.layerOrder[this.layerIndex.get(duplicates.get(node))];
        if (
          underWhich[layer - 1] &&
          this.compareLayerOrder(underWhich[layer - 1], oldLayer.id) <= 0
        ) {
          // 新层应在旧层之下
          // 那么新层就不应出现重复对象
          // pass
        } else {
          // 新层应在旧层之上
          // 那么旧层就不应出现重复对象
          // 且该对象在旧层中一定不是活动对象
          oldLayer.inactiveGraph.deleteNodeUnsafe(node);
        }
      }
      if (objs.includes(node)) {
        // 活动对象
        layers[layer - 1].activeObjects.add(node);
        this.onLayer.set(node, layers[layer - 1]);
        this.activeObjects.add(node);
      } else {
        // 非活动对象
        layers[layer - 1].inactiveGraph.addNodeUnsafe(node);
        for (const next of graph.neighborsUnsafe(node) || []) {
          if (!objs.includes(next) && layerIndex.get(next) === layer) {
            // 仅连接同层非活动对象
            layers[layer - 1].inactiveGraph.addEdgeUnsafe(node, next);
          }
        }
        this.onLayer.set(node, layers[layer - 1]);
      }
    }

    // 插入各层
    layers.forEach((layer, index) => {
      this.insertLayerUnder(layer, underWhich[index]);
    });
  }

  /**
   * 将某层插入到另一层之下
   * @description 层实例应该不存在于 `layerOrder` 中。
   * @param {Layer} layerNow - 要移动的层
   * @param {number | undefined} [layerAbove = undefined] - 要移动到何层之下，若未指定则移至顶层
   */
  insertLayerUnder(layerNow, layerAbove = undefined) {
    let indexAbove = layerAbove
      ? this.layerIndex.get(layerAbove)
      : this.layerOrder.length;
    this.layerOrder.splice(indexAbove, 0, layerNow);
    // 更新 layerIndex
    this.layerOrder.forEach((layer, index) => {
      this.layerIndex.set(layer.id, index);
    });
  }

  /**
   * 比较两层的层次顺序
   * @param {number} layer1 - 层 1 的 id
   * @param {number} layer2 - 层 2 的 id
   * @returns {number} 若层 1 在层 2 之上则返回正数，若层 1 在层 2 之下则返回负数，若二者相等则返回 0
   */
  compareLayerOrder(layer1, layer2) {
    return this.layerIndex.get(layer2) - this.layerIndex.get(layer1);
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
