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
   * 对象 id 到层 id 的映射
   * @type {Map<number, number>}
   */
  onLayer;

  /**
   * 层与层间的顺序
   * @description 层索引 -> 层 id，便于按层次顺序遍历各层。
   * @type {number[]}
   */
  layerOrder;

  /**
   * 层在 `layerOrder` 数组中的索引
   * @description 层 id -> 层索引，便于快速查找某层的位置。
   * @type {Map<number, number>}
   */
  layerIndex;

  constructor() {
    this.activeGraph = new DirectedGraph();
    this.layerPool = new RandomNumberPool(1, 10000000);
    this.initJunkPool();
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
   * 判断某点是否为非虚点
   * @param {number} pointId - 点 id
   * @returns {boolean} 如果该点不是虚点，则返回 true，否则返回 false
   */
  isNotVirtualPoint(pointId) {
    return !(-this.layerPool.max * 2 + 1 <= pointId && pointId <= -1);
  }

  /**
   * 判断某点是否为 A 虚点
   * @param {number} pointId - 点 id
   * @returns {boolean} 如果该点是 A 虚点，则返回 true，否则返回 false
   */
  isAPoint(pointId) {
    return !this.isNotVirtualPoint(pointId) && pointId % 2 === 0;
  }

  /**
   * 判断某点是否为 B 虚点
   * @param {number} pointId - 点 id
   * @returns {boolean} 如果该点是 B 虚点，则返回 true，否则返回 false
   */
  isBPoint(pointId) {
    return !this.isNotVirtualPoint(pointId) && pointId % 2 === 1;
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
   * @todo 检查逻辑问题
   */
  choose(objs, pges) {
    let graph = this.pickup(objs, pges);
    // [todo] 检查逻辑问题

    // ======== 将 graph 分层并删除跨层边 ========
    // see markdown `active-object-manager-document.md`

    /**
     * 待处理的非活动对象队列
     * @type {Queue}
     */
    let inactiveQueue = new Queue();

    /**
     * 每个点暂存的边的映射
     * @description 是指向该点的边，即映射 A --> B 表示有一条边从 A 指向该点 B。
     * @type {Map<*, Set<*>>}
     */
    let stash = new Map();

    /**
     * 当前正在处理的层
     * @description 从 0 开始计数，在处理过程中会不断增加，最终表示图中的最大层数。
     * @type {number}
     */
    let currentLayer = 0;

    /**
     * 当前层的活动对象数
     * @description 当前还需处理多少个活动对象。
     */
    let activeNumber = 0;

    /**
     * 待处理的活动对象队列
     * @type {Queue}
     */
    let activeQueue = new Queue();

    /**
     * 当前图的入度映射
     * @type {Map<*, number>}
     */
    let inDeree;

    /**
     * 每个点与其所在层的映射（临时）
     * @description 用于在处理过程中记录每个点所在的临时层，不是最终加入 `onLayer` 的层。
     * 临时层是从 0 开始计数的连续整数。
     * @type {Map<*, number>}
     */
    let layerMapTemp = new Map();

    // 初始化入度映射，并将所有入度为 0 的点入队
    // see markdown 1. 2. 3.
    inDeree = graph.getInDegreeMap();
    for (const [node, degree] of inDeree.entries()) {
      if (degree === 0) {
        if (objs.includes(node)) {
          activeQueue.push(node);
        } else {
          inactiveQueue.push(node);
        }
        layerMapTemp.set(node, currentLayer);
      }
    }

    // see markdown 7.
    while (!inactiveQueue.empty() || !activeQueue.empty()) {
      // 处理非活动对象
      // see markdown 4.
      if (inactiveQueue.empty() && activeNumber === 0) {
        let p = inactiveQueue.pop();
        const neighbors = graph.neighborsUnsafe(p);
        if (neighbors) {
          for (const q of neighbors) {
            if (layerMapTemp.has(q)) {
              // q 已被访问，且访问它的人的层更低
              if (layerMapTemp.get(q) < currentLayer) {
                // q 的暂存区内都是跨层边
                let presuccs = stash.get(q) || new Set();
                // 将这些边删去
                for (const presucc of presuccs) {
                  graph.deleteEdgeUnsafe(presucc, q);
                }
                // 将暂存区清空
                stash.set(q, new Set());
                // 更新 q 的层
                layerMapTemp.set(q, currentLayer);
              }
            } else {
              // q 第一次被访问
              layerMapTemp.set(q, currentLayer);
            }
            // 入度减一
            let inDeg = inDeree.get(q) || 1;
            inDeg--;
            inDeree.set(q, inDeg);
            // 入度为 0，入队
            if (inDeg === 0) {
              if (objs.includes(q)) {
                activeQueue.push(q);
              } else {
                inactiveQueue.push(q);
              }
            }
            // 将边 p --> q 加入暂存区
            let presuccs = stash.get(q) || new Set();
            presuccs.add(p);
            stash.set(q, presuccs);
          }
        }
      }

      // see markdown 5.
      if (inactiveQueue.empty() && !activeQueue.empty()) {
        // 当前层的非活动对象处理完毕，且有活动对象待处理，进入下一层
        currentLayer++;
        // 计算当前层的活动对象数
        activeNumber = activeQueue.count();
      }

      // 处理活动对象
      // see markdown 6.
      if (!activeQueue.empty() && activeNumber > 0) {
        let p = activeQueue.pop();
        layerMapTemp.set(p, currentLayer);
        const neighbors = graph.neighborsUnsafe(p);
        if (neighbors) {
          for (const q of neighbors) {
            if (layerMapTemp.has(q)) {
              // q 已被访问，且访问它的人的层更低
              if (layerMapTemp.get(q) < currentLayer - 1) {
                // q 的暂存区内都是跨层边
                let presuccs = stash.get(q) || new Set();
                // 将这些边删去
                for (const presucc of presuccs) {
                  graph.deleteEdgeUnsafe(presucc, q);
                }
                // 将暂存区清空
                stash.set(q, new Set());
                // 更新 q 的层
                layerMapTemp.set(q, currentLayer);
              }
            } else {
              // q 第一次被访问
              layerMapTemp.set(q, currentLayer);
            }
            // 入度减一
            let inDeg = inDeree.get(q) || 1;
            inDeg--;
            inDeree.set(q, inDeg);
            // 入度为 0，入队
            if (inDeg === 0) {
              if (objs.includes(q)) {
                activeQueue.push(q);
              } else {
                inactiveQueue.push(q);
              }
            }
            // 将边 p --> q 加入暂存区
            let presuccs = stash.get(q) || new Set();
            presuccs.add(p);
            stash.set(q, presuccs);
          }
        }
        activeNumber--;
      }
    }

    // 为每个临时层分配永久层 id
    let layerTempToPermanent = new Map();
    for (let i = 0; i <= currentLayer; i++) {
      let layer = this.layerPool.generate();
      layerTempToPermanent.set(i, layer);
    }

    // 加入虚点
    // see markdown 10. 11.
    for (let i = 0; i <= currentLayer; i++) {
      let layer = layerTempToPermanent.get(i);
      let aPoint = this.getAPointForLayer(layer);
      let bPoint = this.getBPointForLayer(layer);
      graph.addNodeUnsafe(aPoint);
      graph.addNodeUnsafe(bPoint);
    }

    // 连接虚点

    // 处理活动对象
    // see markdown 9. 13. 14.
    for (const node of objs) {
      let tempLayer = layerMapTemp.get(node);
      graph.deleteAllEdgesOfNodeUnsafe(node);
      let aPoint = this.getAPointForLayer(layerTempToPermanent.get(tempLayer));
      if (tempLayer !== 0) {
        let bPoint = this.getBPointForLayer(
          layerTempToPermanent.get(tempLayer - 1)
        );
        graph.addEdgeUnsafe(bPoint, node);
      }
      graph.addEdgeUnsafe(node, aPoint);
    }

    // 处理入度为 0 的点
    // see markdown 12.
    for (const node of graph.getNoIncomingNodes()) {
      if (!this.isNotVirtualPoint(node)) {
        // 跳过虚点
        continue;
      }
      let tempLayer = layerMapTemp.get(node);
      let aPoint = this.getAPointForLayer(layerTempToPermanent.get(tempLayer));
      graph.addEdgeUnsafe(aPoint, node);
    }

    // 处理出度为 0 的点
    // see markdown 15.
    for (const node of graph.getNoOutgoingNodes()) {
      if (!this.isNotVirtualPoint(node)) {
        // 跳过虚点
        continue;
      }
      let tempLayer = layerMapTemp.get(node);
      let bPoint = this.getBPointForLayer(layerTempToPermanent.get(tempLayer));
      graph.addEdgeUnsafe(node, bPoint);
    }

    // ======== 依据层次关系插入到 activeGraph 中 ========
    // 确立层次关系
    // see markdown 1. 2.
    /**
     * 每个临时层在哪一个永久层之下
     * @description 里面是层索引。也就是 temporary layer index -> permanent layer index。
     * @type {Array<number>}
     */
    let underWhich = [];

    // BFS 遍历一定是遵循层次关系的
    let queue = new Queue();
    const visited = new Set();
    for (const node of graph.getNoIncomingNodes()) {
      queue.push(node);
    }

    /**
     * 当前正在处理的重复点集合
     * @description 用于在遍历过程中记录当前层中已存在于 activeGraph 中的重复点。
     * @type {Array<number>}
     */
    let duplicatesLayer = [];

    /**
     * 所有重复点集合
     * @description 用于在遍历过程中记录所有已存在于 activeGraph 中的重复点。
     * @type {Array<number>}
     */
    let duplicates = [];

    while (!queue.empty()) {
      // bfs logic starts here
      let p = queue.pop();
      if (visited.has(p)) {
        continue;
      }
      visited.add(p);
      // bfs logic ends here

      // 现在到了该层的最上面，开始处理重复点
      if (this.isBPoint(p)) {
        // 现在，看看重复的点中哪一个的层次最低，将该层放在它之下
        let minLayer =
          duplicatesLayer.length > 0
            ? Math.min(
                ...duplicatesLayer.map((d) => {
                  return this.layerIndex.get(this.onLayer.get(d));
                })
              )
            : -1;
        underWhich.push(
          minLayer === -1 ? undefined : this.layerOrder[minLayer]
        );
        duplicatesLayer = [];
      }

      if (this.onLayer.has(p)) {
        // 已存在于 activeGraph 中，标记为重复点
        duplicatesLayer.push(p);
        duplicates.push(p);
      }

      // bfs logic starts here
      const neighbors = graph.neighborsUnsafe(p);
      if (neighbors) {
        for (const q of neighbors) {
          if (!visited.has(q)) {
            queue.push(q);
          }
        }
      }
      // bfs logic ends here
    } // while loop ends here

    // 再度处理：临时层中在上层的对象在永久层中不能出现在下层
    // 向下调整 underWhich
    for (let i = currentLayer - 1; i >= 0; i--) {
      if (
        (underWhich[i] || this.layerOrder.length) >
        (underWhich[i + 1] || this.layerOrder.length)
      ) {
        underWhich[i] = underWhich[i + 1];
      }
    }

    // 开始删去重复的点（用垃圾点替代）
    // [fixme] 这里的逻辑有问题，可能删掉活动点！虽然可以正常显示，但总归是不好的。
    for (const dup of duplicates) {
      let junkId = this.newJunkId();
      // 删的应该是在更下面的那个层里的重复点
      if (this.onLayer.get(dup) >= underWhich[layerMapTemp.get(dup)]) {
        // 在 activeGraph 中的点的层次更高，删去 graph 中的点
        graph.changeNodeNameUnsafe(dup, junkId);
      } else {
        // 在 graph 中的点的层次更高，删去 activeGraph 中的点
        this.activeGraph.changeNodeNameUnsafe(dup, junkId);
      }
    }

    // 将 graph 并入 activeGraph
    // 这里，underWhich 从层索引转换为层 id
    underWhich = underWhich.map((layer) => {
      return layer ? this.layerOrder[layer] : undefined;
    });
    for (let i = 0; i <= currentLayer; i++) {
      this.insertLayerUnder(layerTempToPermanent.get(i), underWhich[i]);
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
