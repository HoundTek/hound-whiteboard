/**
 * @file 全局活动对象管理器
 * @description 管理活动对象的层级、筛选与运行时状态。
 * @module core/components/active-object-manager
 * @author Zhou Chenyu
 */

import { RandomNumberPool } from "../../utils/random.js";
import { Queue } from "../../utils/queue.js";
import { DirectedGraph } from "../../utils/directed-graph.js";
import { Chunk } from "../chunk/chunk.js";
import { ChunkLoader } from "../chunk/chunk-loader.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { intersectsRanges, RectangleRange, Range } from "../../range/index.js";
import { createDefaultAomRenderHooks } from "./aom-render-hooks.js";

/**
 * 层类
 * @description
 * 每一层包含一个 `activeObjects` 集合、一个 `inactiveGraph` 子图，
 * 以及一个表示该层当前是否仍为活动层的 `active` 标记。
 * 当 `active === false` 时，`activeObjects` 中的对象按 inactive 语义处理。
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
   * @description 当 `active === false` 时，该集合中的对象按 inactive 语义处理
   * @type {Set<number>}
   */
  activeObjects;

  /**
   * 该层上的非活动对象子图
   * @type {DirectedGraph}
   */
  inactiveGraph;

  /**
   * 该层当前是否仍是活动层
   * @type {boolean}
   */
  active;

  /**
   * @constructor
   * @param {number} id - 层 id
   */
  constructor(id) {
    this.id = id;
    this.activeObjects = new Set();
    this.inactiveGraph = new DirectedGraph();
    this.active = true;
  }

  /**
   * 清空该层并重置为默认 active 状态
   */
  clear() {
    this.activeObjects.clear();
    this.inactiveGraph.clear();
    this.active = true;
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
   * 当前所有活动对象实例集合
   * @type {Set<BasicObject>}
   */
  activeObjects;

  /**
   * 活动对象 id 到实例的索引
   * @type {Map<number, BasicObject>}
   */
  activeObjectIndex;

  /**
   * 活动对象进入动态图前的世界范围快照
   * @description 用于在提交回静态层时同时失效旧静态像素与新静态像素。
   * @type {Map<number, RectangleRange>}
   */
  baseObjectSnapshotWorldRanges;

  /**
   * 活动对象进入动态图前的覆盖区块快照
   * @description
   * 用于在 apply 时正确识别应从哪些旧区块中移除对象。
   * 和 baseObjectSnapshotWorldRanges 不同，该快照不依赖 ownerChunk 的覆盖索引，
   * 因此多次 apply 间移动对象时仍能定位到正确的旧覆盖区块。
   * @type {Map<number, Set<number>>}
   */
  baseObjectSnapshotCoverChunks;

  /**
   * 所属白板（Core 实例）
   * @type {import("./board-core.js").BoardCore | import("./board.js").Board | undefined}
   */
  board;

  /**
   * AOM 渲染钩子
   * @description 注入式渲染钩子，替代直接访问 board.monitors / monitor.liveRenderer / monitor.baseRenderer。
   * @type {import("./aom-render-hooks.js").AomRenderHooks}
   */
  renderHooks;

  /**
   * @param {import("./board-core.js").BoardCore | import("./board.js").Board} [board] - 所属白板实例
   * @param {{ renderHooks?: import("./aom-render-hooks.js").AomRenderHooks }} [options={}] - 附加选项
   */
  constructor(board, options = {}) {
    this.board = board;
    this.renderHooks = options.renderHooks ?? createDefaultAomRenderHooks();
    this.layerPool = new RandomNumberPool(1, 10000000);
    this.layerOrder = [];
    this.onLayer = new Map();
    this.layerIndex = new Map();
    this.activeObjects = new Set();
    this.activeObjectIndex = new Map();
    this.baseObjectSnapshotWorldRanges = new Map();
    this.baseObjectSnapshotCoverChunks = new Map();
  }

  /**
   * 记录对象进入活动层前的世界范围快照
   * @param {Iterable<BasicObject>} [objects = []] - 待记录对象集合
   */
  captureBaseObjectSnapshot(objects = []) {
    for (const entry of objects ?? []) {
      const objectInstance = this.requireObjectInstance(entry);
      if (this.baseObjectSnapshotWorldRanges.has(objectInstance.id)) continue;

      const worldRange = this.getObjectWorldRange(objectInstance);
      if (!worldRange) continue;

      this.baseObjectSnapshotWorldRanges.set(
        objectInstance.id,
        RectangleRange.from(worldRange),
      );
    }
  }

  /**
   * 记录对象进入活动层前的覆盖区块快照
   * @param {Iterable<BasicObject>} [objects = []] - 待记录对象集合
   */
  captureBaseObjectCoverChunks(objects = []) {
    for (const entry of objects ?? []) {
      const objectInstance = this.requireObjectInstance(entry);
      if (this.baseObjectSnapshotCoverChunks.has(objectInstance.id)) continue;

      const coveredChunkIds = this.calculateCoveredChunkIds(objectInstance);
      this.baseObjectSnapshotCoverChunks.set(
        objectInstance.id,
        new Set(coveredChunkIds),
      );
    }
  }

  /**
   * 清理对象的静态层旧范围快照
   * @param {Iterable<BasicObject>} [objects = []] - 待清理对象集合
   */
  clearBaseObjectSnapshots(objects = []) {
    for (const entry of objects ?? []) {
      const objectInstance = this.requireObjectInstance(entry);
      this.baseObjectSnapshotWorldRanges.delete(objectInstance.id);
      this.baseObjectSnapshotCoverChunks.delete(objectInstance.id);
    }
  }

  /**
   * 断言输入是有效对象实例
   * @param {*} obj - 候选对象
   * @returns {BasicObject}
   */
  requireObjectInstance(obj) {
    if (!(obj instanceof BasicObject)) {
      throw new TypeError(
        "ActiveObjectManager only accepts BasicObject instances.",
      );
    }
    return obj;
  }

  /**
   * 注册活动对象实例
   * @param {BasicObject} obj - 要注册的对象实例
   */
  registerActiveObject(obj) {
    this.requireObjectInstance(obj);
    const previous = this.activeObjectIndex.get(obj.id);
    if (previous) {
      this.activeObjects.delete(previous);
    }
    this.activeObjectIndex.set(obj.id, obj);
    this.activeObjects.add(obj);
  }

  /**
   * 请求所有 monitor 刷新活动层
   * @description 通过 `renderHooks` 委托给 UI 侧实际渲染管线。
   * @param {Iterable<BasicObject>} [objects = []] - 受影响对象集合
   */
  requestLiveRender(objects = []) {
    const changedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );
    this.renderHooks.requestLiveRender(changedObjects);
  }

  /**
   * 请求所有 monitor 刷新静态层
   * @description 通过 `renderHooks` 委托给 UI 侧实际渲染管线。
   */
  requestBaseRender(chunks = []) {
    const normalizedChunks = Array.from(chunks).filter(Boolean);
    this.renderHooks.requestBaseRender(normalizedChunks);
  }

  /**
   * 请求所有 monitor 按对象范围刷新静态层
   * @description 通过 `renderHooks` 委托给 UI 侧实际渲染管线。
   * @param {Iterable<BasicObject>} [objects = []] - 受影响对象集合
   * @param {Iterable<Chunk>} [fallbackChunks = []] - 无法走对象级失效时的回退区块集合
   */
  requestBaseRenderForObjects(objects = [], fallbackChunks = []) {
    const normalizedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );
    const normalizedChunks = Array.from(fallbackChunks).filter(Boolean);
    const previousWorldRects = new Map(this.baseObjectSnapshotWorldRanges);

    this.renderHooks.requestBaseRenderForObjects(
      normalizedObjects,
      normalizedChunks,
      previousWorldRects,
    );
  }

  /**
   * 刷新能看到指定对象集合的那些 monitor 的视口
   * @description 通过 `renderHooks` 委托给 UI 侧实际渲染管线。
   * @param {Array<BasicObject>} objects - 对象实例数组
   * @private
   */
  _flushViewportForObjects(objects = []) {
    const normalizedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );
    this.renderHooks.flushViewportForObjects(normalizedObjects);
  }

  /**
   * 解析静态层对象级失效集合
   * @param {Iterable<BasicObject>} [objects = []] - 起始对象集合
   * @param {Array<{ coveredChunkIds: Set<number>, relatedObjectIds?: Iterable<number> }>} [contexts = []] - 关联上下文
   * @returns {BasicObject[]}
   */
  collectBaseInvalidationObjects(objects = [], contexts = []) {
    const invalidationObjectMap = new Map();

    for (const entry of objects ?? []) {
      const objectInstance = this.requireObjectInstance(entry);
      invalidationObjectMap.set(objectInstance.id, objectInstance);
    }

    for (const context of contexts ?? []) {
      const coveredChunkIds = context?.coveredChunkIds ?? new Set();
      for (const objectId of context?.relatedObjectIds ?? []) {
        if (invalidationObjectMap.has(objectId)) continue;

        const objectInstance = this.findBoardObjectInstance(
          objectId,
          coveredChunkIds,
        );
        if (!(objectInstance instanceof BasicObject)) continue;

        invalidationObjectMap.set(objectId, objectInstance);
      }
    }

    return [...invalidationObjectMap.values()];
  }

  /**
   * 从最终静态图中收集某对象的邻接对象 id
   * @param {number} objectId - 对象 id
   * @param {Iterable<number>} [coveredChunkIds = []] - 相关覆盖区块
   * @returns {Set<number>}
   */
  collectStaticGraphNeighborIds(objectId, coveredChunkIds = []) {
    const relatedObjectIds = new Set();

    for (const chunkId of coveredChunkIds ?? []) {
      const graph =
        this.board?.getChunkById?.(chunkId)?.objectManager?.staticGraph;
      if (!graph?.hasNode?.(objectId)) continue;

      for (const neighborId of graph.neighborsUnsafe?.(objectId) ?? []) {
        relatedObjectIds.add(neighborId);
      }
      for (const predecessorId of graph.predecessorsUnsafe?.(objectId) ?? []) {
        relatedObjectIds.add(predecessorId);
      }
    }

    relatedObjectIds.delete(objectId);
    return relatedObjectIds;
  }

  /**
   * 从全局活动对象索引中移除对象实例
   * @param {number} objectId - 要移除的对象 id
   */
  unregisterTrackedActiveObject(objectId) {
    const activeObject = this.activeObjectIndex.get(objectId);
    if (activeObject) {
      this.activeObjects.delete(activeObject);
      this.activeObjectIndex.delete(objectId);
    }
  }

  /**
   * 按当前全局活动对象索引刷新层的活动状态
   * @param {Layer | undefined} layer - 目标层
   * @returns {boolean}
   */
  updateLayerActiveState(layer) {
    if (!(layer instanceof Layer)) return false;

    layer.active = Array.from(layer.activeObjects).some((objectId) =>
      this.activeObjectIndex.has(objectId),
    );
    return layer.active;
  }

  /**
   * 从给定层的结构中移除对象
   * @param {Layer | undefined} layer - 目标层
   * @param {number} objectId - 对象 id
   */
  removeObjectFromLayerStorage(layer, objectId) {
    if (!(layer instanceof Layer)) return;

    layer.activeObjects.delete(objectId);
    if (layer.inactiveGraph.hasNode(objectId)) {
      layer.inactiveGraph.deleteNodeUnsafe(objectId);
    }
    if (this.onLayer.get(objectId) === layer) {
      this.onLayer.delete(objectId);
    }

    this.updateLayerActiveState(layer);
  }

  /**
   * 从对象所在层的结构中移除对象
   * @param {number} objectId - 对象 id
   */
  removeObjectFromLayer(objectId) {
    this.removeObjectFromLayerStorage(this.onLayer.get(objectId), objectId);
  }

  /**
   * 将一组活动对象失活
   * @description
   * 若同层中仍有其它活动对象，则对象会直接离开该层；
   * 若该层所有活动对象都被本次操作失活，则保留其 `activeObjects` 结构，
   * 仅将层标记为 inactive，以便后续按 inactive 语义参与 duplicate 判断与层级恢复。
   * @param {Iterable<BasicObject>} [objects = []] - 待失活对象集合
   */
  deactivateObjects(objects = []) {
    /** @type {Map<Layer, Set<number>>} */
    const deactivatingObjectIdsByLayer = new Map();

    for (const entry of objects ?? []) {
      const objectInstance = this.requireObjectInstance(entry);
      if (!this.activeObjectIndex.has(objectInstance.id)) continue;

      const layer = this.onLayer.get(objectInstance.id);
      if (!(layer instanceof Layer)) {
        this.unregisterTrackedActiveObject(objectInstance.id);
        continue;
      }

      if (!deactivatingObjectIdsByLayer.has(layer)) {
        deactivatingObjectIdsByLayer.set(layer, new Set());
      }
      deactivatingObjectIdsByLayer.get(layer).add(objectInstance.id);
    }

    for (const [layer, objectIds] of deactivatingObjectIdsByLayer) {
      const hasRemainingTrackedActiveObjects = Array.from(
        layer.activeObjects,
      ).some(
        (objectId) =>
          !objectIds.has(objectId) && this.activeObjectIndex.has(objectId),
      );

      for (const objectId of objectIds) {
        this.unregisterTrackedActiveObject(objectId);
      }

      if (hasRemainingTrackedActiveObjects) {
        for (const objectId of objectIds) {
          if (this.onLayer.get(objectId) === layer) {
            this.onLayer.delete(objectId);
          }
          layer.activeObjects.delete(objectId);
        }
        layer.active = true;
        continue;
      }

      layer.active = false;
    }
  }

  /**
   * 取消注册活动对象实例并从所在层移除
   * @param {number} objectId - 要取消注册的对象 id
   */
  unregisterActiveObject(objectId) {
    this.unregisterTrackedActiveObject(objectId);
    this.removeObjectFromLayer(objectId);
  }

  /**
   * 解析对象起始区块
   * @param {BasicObject} obj
   * @returns {Chunk | undefined}
   */
  resolveObjectChunk(obj) {
    this.requireObjectInstance(obj);

    if (obj && this.board && this.board.width > 0 && this.board.height > 0) {
      const chunkId = Chunk.worldToChunkId(
        obj.position,
        this.board.width,
        this.board.height,
      );
      if (chunkId != null) return this.board.getChunkById(chunkId);
    }

    return undefined;
  }

  /**
   * 创建与白板区块加载事件总线绑定的区块加载器
   * @returns {ChunkLoader}
   */
  createChunkLoader() {
    if (this.board?.createChunkLoader) {
      return this.board.createChunkLoader(`aom-${Date.now()}`);
    }
    return new ChunkLoader();
  }

  /**
   * 获取对象世界坐标范围
   * @param {BasicObject} obj - 要获取世界坐标范围的对象实例
   * @returns {Range | undefined} 对象的世界坐标范围，若无法获取则返回 undefined
   */
  getObjectWorldRange(obj) {
    if (!(obj instanceof BasicObject)) return undefined;
    if (!obj.position || typeof obj.getRange !== "function") return undefined;
    const range = obj.getRange();
    if (!range || typeof range.withPosition !== "function") return undefined;
    return range.withPosition(obj.position);
  }

  /**
   * 在当前白板中查找对象实例
   * @param {number} objectId - 要查找的对象 id
   * @param {Iterable<number>} [candidateChunkIds = []] - 可能包含该对象的区块 id 集合，若提供则优先在这些区块中查找以提升性能
   * @returns {BasicObject | undefined} 查找到的对象实例，若未找到则返回 undefined
   */
  findBoardObjectInstance(objectId, candidateChunkIds = []) {
    const activeObject = this.activeObjectIndex.get(objectId);
    if (activeObject instanceof BasicObject) {
      return activeObject;
    }

    if (!this.board) return undefined;

    const loadedObject = this.board.getObjectById?.(objectId);
    if (loadedObject instanceof BasicObject) {
      return loadedObject;
    }

    const chunkIdsToSearch = new Set(candidateChunkIds);
    for (const chunkId of candidateChunkIds) {
      const chunk = this.board.getChunkById(chunkId);
      const coverChunks =
        chunk?.objectManager?.getObjectCoverChunks(objectId) || [];
      for (const coveredChunkId of coverChunks) {
        chunkIdsToSearch.add(coveredChunkId);
      }
    }

    for (const chunkId of chunkIdsToSearch) {
      const chunk = this.board.getChunkById(chunkId);
      const objectInstance = chunk?.objectManager?.getObject?.(objectId);
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
   * 计算对象覆盖区块集合
   * @param {BasicObject} obj
   * @returns {Set<number>}
   */
  calculateCoveredChunkIds(obj) {
    if (!(obj instanceof BasicObject) || !this.board) {
      return new Set();
    }

    const worldRange = this.getObjectWorldRange(obj);
    if (!worldRange || this.board.width <= 0 || this.board.height <= 0) {
      const chunkId = Chunk.worldToChunkId(
        obj.position,
        this.board.width,
        this.board.height,
      );
      return new Set(chunkId != null ? [chunkId] : []);
    }

    const chunkIds = ChunkObjectManager.calculateCoveredChunkIdsForRange(
      worldRange,
      this.board.width,
      this.board.height,
    );

    if (chunkIds.size === 0) {
      const chunkId = Chunk.worldToChunkId(
        obj.position,
        this.board.width,
        this.board.height,
      );
      if (chunkId != null) chunkIds.add(chunkId);
    }
    return chunkIds;
  }

  /**
   * 收集覆盖区块中的静态对象 id
   * @param {Iterable<number>} coveredChunkIds
   * @returns {Set<number>}
   */
  collectCoveredStaticObjectIds(coveredChunkIds = []) {
    const objectIds = new Set();
    if (!this.board) {
      return objectIds;
    }

    for (const chunkId of coveredChunkIds) {
      const staticGraph =
        this.board.getChunkById(chunkId)?.objectManager?.staticGraph;
      for (const objectId of staticGraph?.getNodes?.() ?? []) {
        objectIds.add(objectId);
      }
    }

    return objectIds;
  }

  /**
   * 收集某层按 inactive 语义参与计算的对象 id
   * @param {Layer} layer
   * @returns {Set<number>}
   */
  collectLayerSemanticInactiveObjectIds(layer) {
    const objectIds = new Set(layer?.inactiveGraph?.getNodes?.() ?? []);

    if (layer?.active === false) {
      for (const objectId of layer.activeObjects ?? []) {
        objectIds.add(objectId);
      }
    }

    return objectIds;
  }

  /**
   * 计算对象在静态图中的上下关系
   * @description
   * 遍历 AOM 所有层，对每层按 inactive 语义参与计算的对象确定 below/above：
   *
   * - 低层 → `below`（在 applied 对象之下）
   * - 同层 → `above`（因为 pickup 只遍历下游，同层非活动一定在 applied 之上）
   * - 高层 → `above`（在 applied 对象之上）
   *
   * 此外，若 `includeUntrackedCoveredObjectsBelow` 为 true，
   * 还会扫描覆盖区块中所有不在 AOM 中的静态对象，与 applied 对象相交的加入 `below`。
   * @param {BasicObject} obj - 要计算的对象实例
   * @param {Set<number>} coveredChunkIds - 该对象的覆盖区块集合
   * @param {Set<number>} applyingObjectIds - 正在被提交的对象 id 集合
   * @param {{includeUntrackedCoveredObjectsBelow?: boolean}} [options]
   * @returns {{below: Set<number>, above: Set<number>}}
   */
  calculateStaticRelations(
    obj,
    coveredChunkIds,
    applyingObjectIds,
    options = {},
  ) {
    const relation = {
      below: new Set(),
      above: new Set(),
    };
    const { includeUntrackedCoveredObjectsBelow = false } = options;
    const currentLayer = this.onLayer.get(obj.id);
    const currentLayerIndex = currentLayer
      ? this.layerIndex.get(currentLayer.id)
      : undefined;

    if (currentLayerIndex === undefined) {
      return relation;
    }

    for (let index = 0; index < this.layerOrder.length; index++) {
      const layer = this.layerOrder[index];

      for (const nodeId of this.collectLayerSemanticInactiveObjectIds(layer)) {
        const candidate = this.findBoardObjectInstance(nodeId, coveredChunkIds);
        if (!(candidate instanceof BasicObject)) continue;
        if (!this.intersectsObjects(obj, candidate)) continue;

        if (index < currentLayerIndex) {
          relation.below.add(nodeId);
        } else if (index > currentLayerIndex) {
          relation.above.add(nodeId);
        } else {
          // 同层 inactive：pickup 从活动对象出发只沿下游遍历（逆边缘方向），
          // 因此同层 inactive 对象在原始静态图中一定处于活动对象的下游。
          // inactive layer 中保留下来的 activeObjects 也按同样语义处理。
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

    if (includeUntrackedCoveredObjectsBelow) {
      for (const nodeId of this.collectCoveredStaticObjectIds(
        coveredChunkIds,
      )) {
        if (nodeId === obj.id) continue;
        if (applyingObjectIds.has(nodeId)) continue;
        if (this.onLayer.has(nodeId)) continue;

        const candidate = this.findBoardObjectInstance(nodeId, coveredChunkIds);
        if (!(candidate instanceof BasicObject)) continue;
        if (!this.intersectsObjects(obj, candidate)) continue;

        relation.below.add(nodeId);
      }
    }

    return relation;
  }

  /**
   * 获取以指定对象集合为起点的子图
   * @description 内部使用 BFS 来遍历图，跨区块对象（尤其是反复横跳的）会造成较大的性能损失
   * @param {Iterable<BasicObject>} startFrom - 作为起点的对象集合
   * @returns {DirectedGraph}
   */
  pickup(startFrom) {
    const visit = new Set();
    const graph = new DirectedGraph();

    /**
     * @param {number} obj - 要拾取的对象 id
     * @param {Chunk} chunk - 该对象所在的区块
     */
    const pickupSingle = (obj, chunk) => {
      if (visit.has(obj)) return;
      visit.add(obj);
      graph.addNodeUnsafe(obj);

      /** @type {Chunk} */
      let chunkNow = chunk;

      // 预创建一个临时加载器，供本次拾取中所有跨区块导航复用
      const tempLoader = this.createChunkLoader();

      /**
       * 按区块坐标获取区块，临时加载未持有的区块
       * @param {number} targetX
       * @param {number} targetY
       * @returns {Chunk|undefined}
       */
      const getChunkAt = (targetX, targetY) => {
        const targetChunk = this.board?.getChunkByCoordinate?.(
          targetX,
          targetY,
        );
        if (targetChunk) {
          tempLoader.trackChunk(targetChunk);
          tempLoader.emitLoadRequest(targetChunk, { strategy: "temp" });
        }
        return targetChunk;
      };

      /**
       * 移动到指定坐标的区块
       * @param {number} targetX
       * @param {number} targetY
       * @returns {boolean}
       */
      const moveToChunk = (targetX, targetY) => {
        const target = getChunkAt(targetX, targetY);
        if (target) {
          chunkNow = target;
          return true;
        }
        return false;
      };

      /**
       * DFS 遍历
       * @description 由于我们的图是薄薄的一层水，所以此处 DFS 不必担心栈溢出的问题。
       * @param {number} node - 对象 id
       */
      function dfs(node) {
        if (!chunkNow?.objectManager) return;
        const neighbors =
          chunkNow.objectManager.staticGraph.neighborsUnsafe(node);

        // 该区块对象
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

        const currentChunkId = chunkNow.id;
        const coveredChunks = chunkNow.objectManager.getObjectCoverChunks(node);
        for (const chunkId of coveredChunks) {
          if (chunkId === currentChunkId) continue;

          const originalX = chunkNow.x;
          const originalY = chunkNow.y;
          const { x: targetX, y: targetY } = Chunk.idToCoordinate(chunkId);
          if (!moveToChunk(targetX, targetY)) {
            moveToChunk(originalX, originalY);
            continue;
          }

          const neighborsOnTarget =
            chunkNow.objectManager.staticGraph.neighborsUnsafe(node);
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

          moveToChunk(originalX, originalY);
        }
      } // function dfs ends here

      dfs(obj);
    }; // function pickupSingle ends here

    for (const entry of startFrom) {
      const obj = this.requireObjectInstance(entry);
      const chunk = this.resolveObjectChunk(obj);
      if (!chunk) continue;
      pickupSingle(obj.id, chunk);
    }

    return graph;
  }

  /**
   * 选取非活动对象并加入活动对象管理器
   * @description
   * 通过 pickup 提取子图，按层依赖关系为对象分配动态层，
   * 再将新层插入到 layerOrder 中的正确位置。
   * @param {Iterable<BasicObject>} startFrom - 要选择的对象集合
   */
  choose(startFrom) {
    // 提取出这些对象所构成的子图
    // 随后遍历子图，按拓扑序 + 活动对象优先级分配层索引
    let graph = this.pickup(startFrom);
    const activeEntries = Array.from(startFrom, (item) =>
      this.requireObjectInstance(item),
    );
    let objs = new Set(activeEntries.map((item) => item.id));
    const activeEntryMap = new Map(
      activeEntries.map((item) => [item.id, item]),
    );
    this.captureBaseObjectSnapshot(activeEntries);
    this.captureBaseObjectCoverChunks(activeEntries);
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
      // 如果新层应在旧层的上方，那旧层里的这个对象就应该被删去，该对象不再为重复对象。
      // 对 inactive layer 来说，activeObjects 也要按 inactive 语义处理。
      if (
        this.compareLayerOrderById(
          underWhich[layerIndex.get(node)],
          this.onLayer.get(node).id,
        ) > 0
      ) {
        this.removeObjectFromLayerStorage(this.onLayer.get(node), node);
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
        this.registerActiveObject(activeEntryMap.get(node));
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

    this.requestLiveRender(activeEntries);
    // 对象已从静态图被拾取到 AOM，需要按对象范围重绘静态层，
    // 让 BaseRenderer 通过 AOM 过滤将它们从 base 层中隐藏，避免整视口重绘。
    this.requestBaseRenderForObjects(activeEntries);
  }

  /**
   * 向活动对象管理器中加入不在白板上的对象
   * @param {Iterable<BasicObject>} objects - 新添加对象集合
   */
  add(objects) {
    const objectEntries = Array.from(objects || [], (item) =>
      this.requireObjectInstance(item),
    );

    const newObjectEntries = objectEntries.filter((item) => {
      return !this.activeObjectIndex.has(item.id);
    });

    if (newObjectEntries.length === 0) {
      return undefined;
    }

    const newLayer = new Layer(this.layerPool.generate());
    for (const objectEntry of newObjectEntries) {
      this.registerActiveObject(objectEntry);
      this.onLayer.set(objectEntry.id, newLayer);
      newLayer.activeObjects.add(objectEntry.id);
    }

    this.insertLayerToTop(newLayer);
    this.requestBaseRenderForObjects(newObjectEntries);
    this.requestLiveRender(newObjectEntries);
    return newLayer;
  }

  /**
   * 清理动态图
   * @description
   * 删除最下面一个 active 层之下的所有 inactive 层，并清理空层。
   * 若当前已不存在 active 层，则删除全部层。
   */
  tidyup() {
    this.layerIndex.clear();

    // 删除最下面一个 active 层之下的所有 inactive 层。
    let count = 0;
    for (const layer of this.layerOrder) {
      if (layer.active) break;
      this.purgeLayerMappings(layer);
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
        this.purgeLayerMappings(this.layerOrder[i]);
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
   * @param {Iterable<BasicObject>} objects
   */
  liftup(objects) {
    /**
     * @description 层索引 -> 新层实例
     * @type {Map<number, Layer>}
     */
    let newLayers = new Map();
    for (const entry of objects) {
      const obj = this.requireObjectInstance(entry);
      const objId = obj.id;
      let layerIndex;
      if (this.activeObjectIndex.has(objId)) {
        let oldLayer = this.onLayer.get(objId);
        layerIndex = this.layerIndex.get(oldLayer.id);
        if (!newLayers.has(layerIndex)) {
          newLayers.set(layerIndex, new Layer(this.layerPool.generate()));
        }
        // 将对象从旧层移除
        oldLayer.activeObjects.delete(objId);
        this.updateLayerActiveState(oldLayer);
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
      .sort(([aIndex, aLayer], [bIndex, bLayer]) => aIndex - bIndex)
      .forEach(([layerIndex, newLayer]) => {
        this.insertLayerToTop(newLayer);
      });
  }

  /**
   * 应用活动对象并取消选择
   * @description
   * 将活动对象按当前动态层关系提交回白板区块静态结构，
   * 清理旧覆盖区块中的残留边，重新计算静态图上下关系，
   * 最后触发 base 层和 live 层渲染。
   * @param {Iterable<BasicObject>} objects
   */
  apply(objects) {
    const normalizedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );

    const canCommitToBoard = Boolean(this.board);
    const commitObjects = [...normalizedObjects];
    const activeBasicObjects = [...normalizedObjects];
    const affectedChunkIds = new Set();

    // 计算出所有受影响的区块 id，以便后续请求静态层渲染时使用
    if (canCommitToBoard && activeBasicObjects.length > 0) {
      const applyingObjectIds = new Set(
        activeBasicObjects.map((item) => item.id),
      );
      const applyContexts = activeBasicObjects
        .map((obj) => {
          const ownerChunk = this.resolveObjectChunk(obj);
          if (!ownerChunk) return undefined;
          const wasOnBoard =
            this.board?.getObjectById?.(obj.id) instanceof BasicObject;
          const previousCoveredChunkIds =
            this.baseObjectSnapshotCoverChunks.get(obj.id) ??
            ownerChunk.objectManager?.getObjectCoverChunks?.(obj.id) ??
            new Set([ownerChunk.id]);
          for (const chunkId of previousCoveredChunkIds) {
            affectedChunkIds.add(chunkId);
          }
          const coveredChunkIds = this.calculateCoveredChunkIds(obj);
          for (const chunkId of coveredChunkIds) {
            affectedChunkIds.add(chunkId);
          }
          // 在清理旧区块前收集旧邻接对象，避免清理后丢失
          const previousNeighborIds = this.collectStaticGraphNeighborIds(
            obj.id,
            previousCoveredChunkIds,
          );
          return {
            obj,
            ownerChunk,
            wasOnBoard,
            previousCoveredChunkIds,
            coveredChunkIds,
            previousNeighborIds,
          };
        })
        .filter(Boolean);

      // 从不再覆盖的旧区块中移除对象
      for (const {
        obj,
        previousCoveredChunkIds,
        coveredChunkIds,
      } of applyContexts) {
        for (const staleChunkId of previousCoveredChunkIds) {
          if (coveredChunkIds.has(staleChunkId)) continue;
          const staleChunk = this.board.getChunkById(staleChunkId);
          staleChunk?.removeObject(obj.id);
        }
      }

      // 确保所有对象都被加入区块
      for (const { obj, ownerChunk, coveredChunkIds } of applyContexts) {
        for (const chunkId of coveredChunkIds) {
          const chunk = this.board.getChunkById(chunkId);
          if (!chunk) continue;
          chunk.addObject(chunkId === ownerChunk.id ? obj : obj.id);
          chunk.objectManager.setObjectCoverChunks(obj.id, coveredChunkIds);
        }
      }

      // 清除对象在覆盖区块中的旧边，避免对象移动后残留之前的关系
      for (const { obj, coveredChunkIds } of applyContexts) {
        for (const chunkId of coveredChunkIds) {
          const chunk = this.board.getChunkById(chunkId);
          if (!chunk?.objectManager) continue;
          const graph = chunk.objectManager.staticGraph;
          if (graph.hasNode(obj.id)) {
            graph.deleteNodeUnsafe(obj.id);
            graph.addNodeUnsafe(obj.id);
          }
        }
      }

      // 再计算它们在静态图中的上下关系
      for (const {
        obj,
        ownerChunk,
        coveredChunkIds,
        wasOnBoard,
      } of applyContexts) {
        const { below, above } = this.calculateStaticRelations(
          obj,
          coveredChunkIds,
          applyingObjectIds,
          { includeUntrackedCoveredObjectsBelow: true },
        );
        for (const chunkId of coveredChunkIds) {
          const chunk = this.board.getChunkById(chunkId);
          if (!chunk) continue;
          chunk.addObject(
            chunkId === ownerChunk.id ? obj : obj.id,
            [...below],
            [...above],
          );
          chunk.objectManager.setObjectCoverChunks(obj.id, coveredChunkIds);
        }
      }

      // 请求静态层失效时，除了直接受影响的对象外，还应包括它们在静态图中的邻接对象
      activeBasicObjects.splice(
        0,
        activeBasicObjects.length,
        ...this.collectBaseInvalidationObjects(
          activeBasicObjects,
          applyContexts.map(
            ({ obj, coveredChunkIds, previousNeighborIds }) => ({
              coveredChunkIds,
              relatedObjectIds: new Set([
                ...(previousNeighborIds ?? []),
                ...(this.collectStaticGraphNeighborIds(
                  obj.id,
                  coveredChunkIds,
                ) ?? []),
              ]),
            }),
          ),
        ),
      );
    }

    // 将对象对应层失活
    this.deactivateObjects(commitObjects);
    this.tidyup();

    // 请求静态层渲染
    this.requestBaseRenderForObjects(
      activeBasicObjects,
      [...affectedChunkIds]
        .map((chunkId) => this.board?.getChunkById?.(chunkId))
        .filter(Boolean),
    );
    this.requestLiveRender(normalizedObjects);
    this.clearBaseObjectSnapshots(normalizedObjects);
  }

  /**
   * 将对象从白板上移除并取消选择
   * @description
   * 从所有覆盖区块的 ChunkObjectManager 静态图中彻底删除对象，
   * 同时清理活动对象索引和动态图层。
   * 与 apply 不同，remove 不会把对象写回静态图，而是从静态图中移除。
   * 与 discard 不同，remove 会同步修改白板区块静态结构。
   * @param {Iterable<BasicObject>} objects
   */
  remove(objects) {
    const normalizedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );

    const removedObjects = [...normalizedObjects];
    const canAccessBoard = Boolean(this.board);
    const affectedChunkIds = new Set();

    // 收集受影响的区块和上下文信息
    if (canAccessBoard && normalizedObjects.length > 0) {
      const removeContexts = normalizedObjects
        .map((obj) => {
          const ownerChunk = this.resolveObjectChunk(obj);
          const previousCoveredChunkIds =
            this.baseObjectSnapshotCoverChunks.get(obj.id) ??
            ownerChunk?.objectManager?.getObjectCoverChunks?.(obj.id) ??
            (ownerChunk ? new Set([ownerChunk.id]) : new Set());
          for (const chunkId of previousCoveredChunkIds) {
            affectedChunkIds.add(chunkId);
          }
          const coveredChunkIds = this.calculateCoveredChunkIds(obj);
          for (const chunkId of coveredChunkIds) {
            affectedChunkIds.add(chunkId);
          }
          // 在清理静态图前收集邻接对象
          const neighborIds = this.collectStaticGraphNeighborIds(
            obj.id,
            new Set([...previousCoveredChunkIds, ...coveredChunkIds]),
          );
          return {
            obj,
            ownerChunk,
            coveredChunkIds,
            neighborIds,
          };
        })
        .filter(Boolean);

      // 从所有覆盖区块的静态图中移除对象节点、关联边和覆盖索引
      for (const { obj, coveredChunkIds } of removeContexts) {
        for (const chunkId of coveredChunkIds) {
          const chunk = this.board.getChunkById(chunkId);
          chunk?.removeObject(obj.id);
        }
      }

      // 构建 base 层失效对象集合
      normalizedObjects.splice(
        0,
        normalizedObjects.length,
        ...this.collectBaseInvalidationObjects(
          normalizedObjects,
          removeContexts.map(({ obj, coveredChunkIds, neighborIds }) => ({
            coveredChunkIds,
            relatedObjectIds: new Set([...(neighborIds ?? [])]),
          })),
        ),
      );
    }

    // 将对象从活动层移除（同时处理 active / inactive layer 中的对象）
    for (const entry of removedObjects) {
      const objId = entry.id;
      this.unregisterTrackedActiveObject(objId);
      if (this.onLayer.has(objId)) {
        this.removeObjectFromLayer(objId);
      }
    }
    this.tidyup();

    // 请求静态层和活动层渲染
    this.requestBaseRenderForObjects(
      normalizedObjects,
      [...affectedChunkIds]
        .map((chunkId) => this.board?.getChunkById?.(chunkId))
        .filter(Boolean),
    );
    this.requestLiveRender(normalizedObjects);
    this.clearBaseObjectSnapshots(normalizedObjects);
  }

  /**
   * 取消活动对象而不提交回白板
   * @description
   * 将对象从全局活动对象索引中移除，不修改区块静态结构。
   * 若对象所在层因此失去全部活动对象，则该层会被标记为 inactive，
   * 并继续保留在动态图中，直到后续 `tidyup()` 将其清理。
   * @param {Iterable<BasicObject>} objects
   */
  discard(objects) {
    const normalizedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );

    this.deactivateObjects(normalizedObjects);
    this.tidyup();
    this.requestBaseRenderForObjects(normalizedObjects);
    this.requestLiveRender(normalizedObjects);
    this.clearBaseObjectSnapshots(normalizedObjects);
  }

  /**
   * 判断指定对象 id 是否当前在 AOM 中（不论活跃与否）
   * @param {number} objectId - 对象 id
   * @returns {boolean}
   */
  has(objectId) {
    return this.onLayer.has(objectId);
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
   * 清理给定层的 `onLayer` 映射和 `layerPool`
   * @param {Layer} layer - 要清理的层
   */
  purgeLayerMappings(layer) {
    for (const objectId of layer.activeObjects) {
      this.onLayer.delete(objectId);
    }
    for (const objectId of layer.inactiveGraph.getNodes()) {
      this.onLayer.delete(objectId);
    }
    this.layerPool.remove(layer.id);
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
