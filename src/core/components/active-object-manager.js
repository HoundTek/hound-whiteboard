/**
 * 全局活动对象管理器
 * @module active-object-manager
 * @author Zhou Chenyu
 */

import { RandomNumberPool } from "../utils/random.js";
import { Deque } from "../utils/deque.js";
import { Queue } from "../utils/queue.js";
import { DirectedGraph } from "../utils/directed-graph.js";
import { Page } from "./page.js";
import { PageLoader } from "./page-loader.js";
import { PageObjectManager } from "./page-object-manager.js";
import { BasicObject } from "../objects/basic-obj.js";
import { intersectsRanges } from "../range/index.js";

/**
 * 层类
 * @description 每一层包含一些活动对象和一些非活动对象，层与层之间有顺序关系。
 * @class
 * @author Zhou Chenyu
 */
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

  /**
   * @constructor
   * @param {number} id - 层 id
   */
  constructor(id) {
    this.id = id;
    this.activeObjects = new Set();
    this.inactiveGraph = new DirectedGraph();
  }

  /**
   * 清空该层
   */
  clear() {
    this.activeObjects.clear();
    this.inactiveGraph.clear();
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
   * @type {Set<BasicObject>}
   */
  activeObjects;

  /**
   * 活动对象 id 到实例的索引
   * @type {Map<number, BasicObject>}
   */
  activeObjectIndex;

  /**
   * 所属白板
   * @type {import("./board.js").Board | undefined}
   */
  board;

  constructor(board) {
    this.board = board;
    this.layerPool = new RandomNumberPool(1, 10000000);
    this.layerOrder = [];
    this.onLayer = new Map();
    this.layerIndex = new Map();
    this.activeObjects = new Set();
    this.activeObjectIndex = new Map();
  }

  /**
   * 解析输入中的对象 id
   * @param {BasicObject | {id?: number} | number} input
   * @returns {number | undefined}
   */
  resolveObjectId(input) {
    if (Number.isInteger(input)) return input;
    if (Number.isInteger(input?.id)) return input.id;
    return undefined;
  }

  /**
   * 将输入归一化为对象实例或兼容对象
   * @param {BasicObject | {id?: number, ownerPageId?: number, page?: Page} | number} input
   * @returns {BasicObject | {id: number, ownerPageId?: number, page?: Page} | undefined}
   */
  normalizeObjectInput(input) {
    if (input instanceof BasicObject) {
      return input;
    }

    if (Number.isInteger(input)) {
      return this.activeObjectIndex.get(input);
    }

    if (Number.isInteger(input?.id)) {
      return {
        ...input,
        ownerPageId: input.ownerPageId ?? input.page?.id,
      };
    }

    return undefined;
  }

  /**
   * 注册活动对象实例
   * @param {BasicObject | {id: number}} obj - 要注册的对象实例或兼容对象
   */
  registerActiveObject(obj) {
    if (!obj || !Number.isInteger(obj.id)) return;
    const previous = this.activeObjectIndex.get(obj.id);
    if (previous) {
      this.activeObjects.delete(previous);
    }
    this.activeObjectIndex.set(obj.id, obj);
    this.activeObjects.add(obj);
  }

  /**
   * 取消注册活动对象实例
   * @param {number} objectId - 要取消注册的对象 id
   */
  unregisterActiveObject(objectId) {
    const activeObject = this.activeObjectIndex.get(objectId);
    if (activeObject) {
      this.activeObjects.delete(activeObject);
      this.activeObjectIndex.delete(objectId);
    }

    const layer = this.onLayer.get(objectId);
    if (layer) {
      layer.activeObjects.delete(objectId);
    }
    this.onLayer.delete(objectId);
  }

  /**
   * 解析对象起始页
   * @param {BasicObject | {id: number, ownerPageId?: number, page?: Page}} obj
   * @returns {Page | undefined}
   */
  resolveObjectPage(obj) {
    if (obj?.page instanceof Page) {
      return obj.page;
    }

    if (Number.isInteger(obj?.ownerPageId) && this.board) {
      return this.board.getPageById(obj.ownerPageId);
    }

    return undefined;
  }

  /**
   * 创建与白板页加载事件总线绑定的页加载器
   * @returns {PageLoader}
   */
  createPageLoader() {
    if (this.board?.createPageLoader) {
      return this.board.createPageLoader(undefined, `aom-${Date.now()}`);
    }
    return new PageLoader();
  }

  /**
   * 获取对象世界坐标范围
   * @param {BasicObject} obj
   * @returns {import("../range/range.js").Range | undefined}
   */
  getObjectWorldRange(obj) {
    if (!(obj instanceof BasicObject)) return undefined;
    if (!obj.position || typeof obj.getRange !== "function") return undefined;
    return obj.getRange().withPosition(obj.position);
  }

  /**
   * 在当前白板中查找对象实例
   * @param {number} objectId
   * @param {Iterable<number>} [candidatePageIds = []]
   * @returns {BasicObject | undefined}
   */
  findBoardObjectInstance(objectId, candidatePageIds = []) {
    const activeObject = this.activeObjectIndex.get(objectId);
    if (activeObject instanceof BasicObject) {
      return activeObject;
    }

    if (!this.board) return undefined;

    const pageIdsToSearch = new Set(candidatePageIds);
    for (const pageId of candidatePageIds) {
      const page = this.board.getPageById(pageId);
      const coverPages =
        page?.objectManager?.getObjectCoverPages(objectId) || [];
      for (const coveredPageId of coverPages) {
        pageIdsToSearch.add(coveredPageId);
      }
    }

    for (const pageId of pageIdsToSearch) {
      const page = this.board.getPageById(pageId);
      const objectInstance = page?.objectManager?.pageObjects?.get(objectId);
      if (objectInstance instanceof BasicObject) {
        return objectInstance;
      }
    }

    return undefined;
  }

  /**
   * 判断两个对象是否相交
   * @param {BasicObject} left
   * @param {BasicObject} right
   * @returns {boolean}
   */
  intersectsObjects(left, right) {
    const leftRange = this.getObjectWorldRange(left);
    const rightRange = this.getObjectWorldRange(right);
    if (!leftRange || !rightRange) return false;
    return intersectsRanges(leftRange, rightRange);
  }

  /**
   * 计算对象覆盖页集合
   * @param {BasicObject} obj
   * @returns {Set<number>}
   */
  calculateCoveredPageIds(obj) {
    if (!(obj instanceof BasicObject) || !this.board) {
      return new Set(
        Number.isInteger(obj?.ownerPageId) ? [obj.ownerPageId] : [],
      );
    }

    const worldRange = this.getObjectWorldRange(obj);
    if (!worldRange || this.board.width <= 0 || this.board.height <= 0) {
      return new Set([obj.ownerPageId]);
    }

    const pageIds = PageObjectManager.calculateCoveredPageIdsForRange(
      worldRange,
      this.board.width,
      this.board.height,
    );

    if (pageIds.size === 0) {
      pageIds.add(obj.ownerPageId);
    }
    return pageIds;
  }

  /**
   * 计算对象在静态图中的上下关系
   * @param {BasicObject} obj - 要计算的对象实例
   * @param {Set<number>} coveredPageIds - 该对象的覆盖页集合
   * @param {Set<number>} applyingObjectIds - 正在被提交的对象 id 集合
   * @returns {{below: Set<number>, above: Set<number>}}
   */
  calculateStaticRelations(obj, coveredPageIds, applyingObjectIds) {
    const relation = {
      below: new Set(),
      above: new Set(),
    };
    const currentLayer = this.onLayer.get(obj.id);
    const currentLayerIndex = currentLayer
      ? this.layerIndex.get(currentLayer.id)
      : undefined;

    if (currentLayerIndex === undefined) {
      return relation;
    }

    for (let index = 0; index < this.layerOrder.length; index++) {
      const layer = this.layerOrder[index];

      for (const nodeId of layer.inactiveGraph.getNodes()) {
        const candidate = this.findBoardObjectInstance(nodeId, coveredPageIds);
        if (!(candidate instanceof BasicObject)) continue;
        if (!this.intersectsObjects(obj, candidate)) continue;

        if (index < currentLayerIndex) {
          relation.below.add(nodeId);
        } else if (index > currentLayerIndex) {
          relation.above.add(nodeId);
        }
      }
    }

    for (const otherObjectId of applyingObjectIds) {
      if (otherObjectId === obj.id) continue;
      const otherObject = this.activeObjectIndex.get(otherObjectId);
      if (!(otherObject instanceof BasicObject)) continue;
      if (!this.intersectsObjects(obj, otherObject)) continue;

      const otherLayer = this.onLayer.get(otherObjectId);
      if (!otherLayer) continue;
      const otherLayerIndex = this.layerIndex.get(otherLayer.id);
      if (otherLayerIndex === undefined) continue;

      if (otherLayerIndex < currentLayerIndex) {
        relation.below.add(otherObjectId);
      } else if (otherLayerIndex > currentLayerIndex) {
        relation.above.add(otherObjectId);
      }
    }

    return relation;
  }

  /**
   * 获取以指定对象集合为起点的子图
   * @description 内部使用 BFS 来遍历图，跨页对象（尤其是反复横跳的）会造成较大的性能损失
   * @param {Set<BasicObject | {id: number, ownerPageId?: number, page?: Page}>} startFrom - 作为起点的对象集合
   * @returns {DirectedGraph}
   */
  pickup(startFrom) {
    const visit = new Set();
    const graph = new DirectedGraph();

    /**
     * @param {number} obj - 要拾取的对象 id
     * @param {Page} pge - 该对象所在的页
     */
    const pickupSingle = (obj, pge) => {
      if (visit.has(obj)) return;
      visit.add(obj);
      graph.addNodeUnsafe(obj);

      let pageLoader = this.createPageLoader();
      // 初始化页加载器，预加载当前页
      pageLoader.resetCurrentPage(pge);

      /**
       * 将页加载器移动到指定坐标
       * @param {number} targetX - 目标页坐标 x
       * @param {number} targetY - 目标页坐标 y
       * @returns {boolean}
       */
      function movePageLoaderTo(targetX, targetY) {
        while (pageLoader.pageNow && pageLoader.pageNow.x < targetX) {
          if (!pageLoader.forceMoveCurrentRightTempLoad()) return false;
        }
        while (pageLoader.pageNow && pageLoader.pageNow.x > targetX) {
          if (!pageLoader.forceMoveCurrentLeftTempLoad()) return false;
        }
        while (pageLoader.pageNow && pageLoader.pageNow.y < targetY) {
          if (!pageLoader.forceMoveCurrentUpTempLoad()) return false;
        }
        while (pageLoader.pageNow && pageLoader.pageNow.y > targetY) {
          if (!pageLoader.forceMoveCurrentDownTempLoad()) return false;
        }

        return (
          pageLoader.pageNow?.x === targetX && pageLoader.pageNow?.y === targetY
        );
      }

      /**
       * DFS 遍历
       * @description 由于我们的图是薄薄的一层水，所以此处 DFS 不必担心栈溢出的问题。
       * @param {number} node - 对象 id
       */
      function dfs(node) {
        const pageNow = pageLoader.pageNow;
        if (!pageNow?.objectManager) return;
        const neighbors =
          pageNow.objectManager.staticGraph.neighborsUnsafe(node);

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

        const currentPageId = pageNow.id;
        const coveredPages = pageNow.objectManager.getObjectCoverPages(node);
        for (const pageId of coveredPages) {
          if (pageId === currentPageId) continue;

          const originalX = pageLoader.pageNow.x;
          const originalY = pageLoader.pageNow.y;
          const { x: targetX, y: targetY } = Page.idToCoordinate(pageId);
          if (!movePageLoaderTo(targetX, targetY)) {
            movePageLoaderTo(originalX, originalY);
            continue;
          }

          const neighborsOnTarget =
            pageLoader.pageNow.objectManager.staticGraph.neighborsUnsafe(node);
          if (neighborsOnTarget) {
            for (const next of neighborsOnTarget) {
              if (!visit.has(next)) {
                visit.add(next);
                graph.addNodeUnsafe(next);
                dfs(next);
              }
              graph.addEdgeUnsafe(node, next);
            }
          }

          movePageLoaderTo(originalX, originalY);
        }
      } // function dfs ends here

      dfs(obj);
    }; // function pickupSingle ends here

    for (const entry of startFrom) {
      const obj = this.normalizeObjectInput(entry);
      const objectId = this.resolveObjectId(obj);
      const page = this.resolveObjectPage(obj);
      if (!Number.isInteger(objectId) || !page) continue;
      pickupSingle(objectId, page);
    }

    return graph;
  }

  /**
   * 选取非活动对象并加入活动对象管理器
   * @param {Set<BasicObject | {id: number, ownerPageId?: number, page?: Page}>} startFrom - 要选择的对象集合
   */
  choose(startFrom) {
    // 提取出这些对象所构成的子图
    let graph = this.pickup(startFrom);
    const activeEntries = Array.from(startFrom, (item) =>
      this.normalizeObjectInput(item),
    );
    let objs = new Set(
      activeEntries
        .map((item) => this.resolveObjectId(item))
        .filter(Number.isInteger),
    );
    const activeEntryMap = new Map(
      activeEntries
        .filter((item) => Number.isInteger(this.resolveObjectId(item)))
        .map((item) => [this.resolveObjectId(item), item]),
    );
    startFrom = null; // 释放内存

    // 获取对象所在层
    /** @description 对象 id -> 层索引 @type {Map<number, number>} */
    let layerIndex = new Map();
    // BFS logic
    let visit = new Set();
    let queue = new Queue();
    for (const node of graph.getNoIncomingNodes()) {
      visit.add(node);
      queue.push(node);
      layerIndex.set(node, 0);
    }
    // 某点所在的层数指“从入度为 0 的点到该点的所有链中拥有活动点数量的最大值”
    // 这里是层索引，层索引 = 层数 - 1
    while (!queue.empty()) {
      let node = queue.pop();
      let layerNow = layerIndex.get(node);
      for (const next of graph.neighborsUnsafe(node) || []) {
        // 计算 next 的层数
        if (objs.has(next)) {
          // 活动对象所在层数至少比它的前驱层数大 1
          layerIndex.set(
            next,
            Math.max(layerNow + 1, layerIndex.get(next) || -1),
          );
        } else {
          // 非活动对象所在层数至少和它的前驱层数一样
          layerIndex.set(next, Math.max(layerNow, layerIndex.get(next) || -1));
        }
        // BFS logic
        if (!visit.has(next)) {
          visit.add(next);
          queue.push(next);
        }
      }
    }

    // 处理层的上下关系
    let layerCount = Math.max(...layerIndex.values()) + 1;
    /**
     * 新层在哪一层之下
     * @description 新层索引 -> 旧层 id；若为 undefined 表示它在最上面
     * @type {Array<number | undefined>}
     */
    let underWhich = Array.from({ length: layerCount }, () => undefined);
    /** @description 新层索引 -> 新层实例 @type {Array<Layer>} */
    let layers = Array.from(
      { length: layerCount },
      () => new Layer(this.layerPool.generate()),
    );
    /** 记录重复对象 id @type {Set<number>} */
    let duplicates = new Set();
    for (const node of graph.getNodes()) {
      let layerIdx = layerIndex.get(node);
      if (this.activeObjectIndex.has(node)) {
        // 它是以前就有的活动对象
        // 此时该层应在其之下
        if (underWhich[layerIdx]) {
          if (
            this.compareLayerOrderById(
              underWhich[layerIdx],
              this.onLayer.get(node).id,
            ) > 0
          ) {
            // 如果新层本来应在旧层之上，那么调整为新层应在旧层之下
            underWhich[layerIdx] = this.onLayer.get(node).id;
          }
        } else {
          underWhich[layerIdx] = this.onLayer.get(node).id;
        }
        duplicates.add(node);
      } else if (this.onLayer.has(node)) {
        // 它以前就有，但不是活动对象
        // 对该层的上下关系无影响
        duplicates.add(node);
      }
    }

    // 处理在旧层中的重复对象
    for (const node of duplicates.values()) {
      // 如果新层应在旧层的上方，那旧层里的这个对象就应该被删去，该对象不再为重复对象
      if (
        this.compareLayerOrderById(
          underWhich[layerIndex.get(node)],
          this.onLayer.get(node).id,
        ) > 0
      ) {
        this.onLayer.get(node).inactiveGraph.deleteNodeUnsafe(node);
        duplicates.delete(node);
      }
    }

    // 将对象加入新层，重复对象将不会被加入
    for (const node of graph.getNodes()) {
      let newLayer = layers[layerIndex.get(node) || 0];
      if (objs.has(node)) {
        // 该对象是新活动对象，加入新层中的活动对象集
        // 新活动对象在这个位置绝对不可能是重复对象
        newLayer.activeObjects.add(node);
        this.onLayer.set(node, newLayer);
        this.registerActiveObject(activeEntryMap.get(node) || { id: node });
      } else {
        if (!duplicates.has(node)) {
          // 必须是非重复对象才能加入此处
          if (!newLayer.inactiveGraph.hasNode(node)) {
            newLayer.inactiveGraph.addNodeUnsafe(node);
          }
          for (const next of graph.neighborsUnsafe(node)) {
            if (duplicates.has(next)) continue;
            if (layers[layerIndex.get(next)].id !== newLayer.id) continue;
            // 必须是非重复对象和同层对象才能连边
            if (!newLayer.inactiveGraph.hasNode(next)) {
              newLayer.inactiveGraph.addNodeUnsafe(next);
            }
            newLayer.inactiveGraph.addEdgeUnsafe(node, next);
          }
          this.onLayer.set(node, newLayer);
        }
      }
    }

    // 确保旧层的顺序不变，从上到下遍历 underWhich，把下层“拽”到上层之下
    // 确保 this.compareLayerOrder(underWhich[i], underWhich[i + 1]) <= 0
    for (let i = underWhich.length - 2; i >= 0; i--) {
      if (underWhich[i] && underWhich[i + 1]) {
        if (
          !(this.compareLayerOrderById(underWhich[i], underWhich[i + 1]) <= 0)
        ) {
          // 下层居然在上层的上面，这是绝对不允许的
          underWhich[i] = underWhich[i + 1];
        }
      } else if (underWhich[i]) {
        // 下层未定义，那下层就是在最上面的
        underWhich[i] = underWhich[i + 1];
      }
    }

    // 将层插入到正确的位置（正着插）
    for (let i = 0; i < layers.length; i++) {
      this.insertLayerUnderById(layers[i], underWhich[i]);
    }
  }

  /**
   * 向活动对象管理器中加入不在白板上的对象
   * @param {Set<BasicObject>} objects - 新添加对象集合
   */
  add(objects) {
    const objectEntries = Array.from(objects || [], (item) =>
      this.normalizeObjectInput(item),
    ).filter(Boolean);

    const newObjectEntries = objectEntries.filter((item) => {
      const objectId = this.resolveObjectId(item);
      return Number.isInteger(objectId) && !this.activeObjectIndex.has(objectId);
    });

    if (newObjectEntries.length === 0) {
      return undefined;
    }

    const newLayer = new Layer(this.layerPool.generate());
    for (const objectEntry of newObjectEntries) {
      const objectId = this.resolveObjectId(objectEntry);
      if (!Number.isInteger(objectId)) continue;
      this.registerActiveObject(objectEntry);
      this.onLayer.set(objectId, newLayer);
      newLayer.activeObjects.add(objectId);
    }

    this.insertLayerToTop(newLayer);
    return newLayer;
  }

  /**
   * 清理动态图
   */
  tidyup() {
    // 删除无法被访问到的层
    let count = 0;
    for (const layer of this.layerOrder) {
      if (layer.activeObjects.size !== 0) break;
      layer.clear();
      count++;
    }
    this.layerOrder.splice(0, count);
    // 删除空层
    for (let i = 0; i < this.layerOrder.length; i++) {
      if (
        this.layerOrder[i].activeObjects.size === 0 &&
        this.layerOrder[i].inactiveGraph.getNodes().length === 0
      ) {
        this.layerOrder[i].clear();
        this.layerOrder.splice(i, 1);
        i--;
      }
    }
    // 更新 layerIndex
    this.layerOrder.forEach((layer, index) => {
      this.layerIndex.set(layer.id, index);
    });
  }

  /**
   * 置顶选择对象
   * @param {Set<BasicObject | {id: number} | number>} objects
   */
  liftup(objects) {
    /**
     * @description 层索引 -> 新层实例
     * @type {Map<number, Layer>}
     */
    let newLayers = new Map();
    for (const entry of objects) {
      const objId = this.resolveObjectId(entry);
      if (!Number.isInteger(objId)) continue;
      let layerIndex;
      if (this.activeObjectIndex.has(objId)) {
        let oldLayer = this.onLayer.get(objId);
        layerIndex = this.layerIndex.get(oldLayer.id);
        if (!newLayers.has(layerIndex)) {
          newLayers.set(layerIndex, new Layer(this.layerPool.generate()));
        }
        // 将对象从旧层移除
        oldLayer.activeObjects.delete(objId);
      } else {
        layerIndex = this.layerOrder.length;
        if (!newLayers.has(layerIndex)) {
          newLayers.set(layerIndex, new Layer(this.layerPool.generate()));
        }
      }

      // 将对象加入新层
      let newLayer = newLayers.get(layerIndex);
      this.onLayer.set(objId, newLayer);
      newLayer.activeObjects.add(objId);
    }
    this.tidyup();
    Array.from(newLayers.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([layerIndex, newLayer]) => {
        this.insertLayerToTop(newLayer);
      });
  }

  /**
   * 应用活动对象并取消选择
   * @param {Set<BasicObject | {id: number} | number>} objects
   */
  apply(objects) {
    const normalizedObjects = Array.from(objects, (item) =>
      this.normalizeObjectInput(item),
    )
      .map((item) => {
        if (item instanceof BasicObject) return item;
        const objectId = this.resolveObjectId(item);
        return Number.isInteger(objectId)
          ? this.activeObjectIndex.get(objectId) || item
          : undefined;
      })
      .filter(Boolean);

    const canCommitToBoard = Boolean(this.board);
    const activeBasicObjects = normalizedObjects.filter(
      (item) => item instanceof BasicObject,
    );

    if (canCommitToBoard && activeBasicObjects.length > 0) {
      const applyingObjectIds = new Set(
        activeBasicObjects.map((item) => item.id),
      );
      const applyContexts = activeBasicObjects
        .map((obj) => {
          const ownerPage = this.resolveObjectPage(obj);
          if (!ownerPage) return undefined;
          return {
            obj,
            ownerPage,
            coveredPageIds: this.calculateCoveredPageIds(obj),
          };
        })
        .filter(Boolean);

      for (const { obj, ownerPage, coveredPageIds } of applyContexts) {
        for (const pageId of coveredPageIds) {
          const page = this.board.getPageById(pageId);
          if (!page) continue;
          page.addObject(pageId === ownerPage.id ? obj : obj.id);
          page.objectManager.setObjectCoverPages(obj.id, coveredPageIds);
        }
      }

      for (const { obj, ownerPage, coveredPageIds } of applyContexts) {
        const { below, above } = this.calculateStaticRelations(
          obj,
          coveredPageIds,
          applyingObjectIds,
        );
        for (const pageId of coveredPageIds) {
          const page = this.board.getPageById(pageId);
          if (!page) continue;
          page.addObject(
            pageId === ownerPage.id ? obj : obj.id,
            [...below],
            [...above],
          );
          page.objectManager.setObjectCoverPages(obj.id, coveredPageIds);
        }
      }
    }

    for (const entry of normalizedObjects) {
      const objId = this.resolveObjectId(entry);
      if (!Number.isInteger(objId) || !this.activeObjectIndex.has(objId)) {
        continue;
      }
      this.unregisterActiveObject(objId);
    }
    this.tidyup();
  }

  /**
   * 兼容旧接口：取消选择对象
   * @param {Set<BasicObject | {id: number} | number>} objects
   */
  remove(objects) {
    this.apply(objects);
  }

  /**
   * 将某层插入到另一层之下
   * @description 欲插入的那一层的实例应该不存在于 `layerOrder` 中。
   * @param {Layer} layerNow - 要插入的层
   * @param {Layer | undefined} [layerAbove = undefined] - 要插入到何层之下，若未指定则移至顶层
   */
  insertLayerUnder(layerNow, layerAbove) {
    this.insertLayerUnderById(layerNow, layerAbove ? layerAbove.id : undefined);
  }

  /**
   * 将某层插入到另一层（用 id 表示）之下
   * @description 欲插入的那一层的实例应该不存在于 `layerOrder` 中。
   * @param {Layer} layerNow - 要插入的层
   * @param {number | undefined} [layerAboveId = undefined] - 要插入到何层之下，若未指定则移至顶层，是层 id
   */
  insertLayerUnderById(layerNow, layerAboveId) {
    let indexAbove = layerAboveId
      ? this.layerIndex.get(layerAboveId)
      : this.layerOrder.length;
    this.layerOrder.splice(indexAbove, 0, layerNow);
    // 更新 layerIndex
    for (let i = indexAbove; i < this.layerOrder.length; i++) {
      this.layerIndex.set(this.layerOrder[i].id, i);
    }
  }

  /**
   * 将某层插入至顶层
   * @param {Layer} layerNow - 要插入的层
   * @description 欲插入的那一层的实例应该不存在于 `layerOrder` 中。
   */
  insertLayerToTop(layerNow) {
    this.insertLayerUnderById(layerNow, undefined);
  }

  /**
   * 比较两层的层次顺序（用 id 表示）
   * @param {number | undefined} layer1 - 层 1 的 id
   * @param {number | undefined} layer2 - 层 2 的 id
   * @returns {number} 若层 1 在层 2 之上则返回正数，若层 1 在层 2 之下则返回负数，若二者相等则返回 0
   */
  compareLayerOrderById(layer1, layer2) {
    if (layer1 === layer2) return 0;
    if (layer1 === undefined) return 1;
    if (layer2 === undefined) return -1;
    return this.layerIndex.get(layer1) - this.layerIndex.get(layer2);
  }

  /**
   * 比较两层的层次顺序
   * @param {Layer} layer1 - 层 1 的实例
   * @param {Layer} layer2 - 层 2 的实例
   * @returns {number} 若层 1 在层 2 之上则返回正数，若层 1 在层 2 之下则返回负数，若二者相等则返回 0
   */
  compareLayerOrder(layer1, layer2) {
    return this.compareLayerOrderById(layer1.id, layer2.id);
  }
}

export { ActiveObjectManager, Layer };
