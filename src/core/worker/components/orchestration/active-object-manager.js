/**
 * @file 全局活动对象管理器
 * @description 管理活动对象的层级、筛选与运行时状态。
 * @module core/worker/components/orchestration/active-object-manager
 * @author Zhou Chenyu
 */

import { RandomNumberPool } from "../../../utils/random.js";
import { Queue } from "../../../utils/queue.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { Chunk } from "../chunk/chunk.js";
import { ChunkLoader, CHUNK_LOAD_EVENTS } from "../chunk/chunk-loader.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { BasicObject } from "../../../shared/objects/basic-obj.js";
import {
  intersectsRanges,
  RectangleRange,
  Range,
} from "../../../shared/range/index.js";
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
    if (this._dormantInstances) {
      this._dormantInstances.clear();
    }
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
   * 活动对象 id 到实例的本地缓存
   * @description
   * BoardCore.objectLoaded 是对象实例的唯一权威持有者。
   * activeObjectIndex 是 AOM 的本地快速查找缓存，与 BoardCore 指向同一个实例，
   * 两者之间不会产生分歧。该缓存使渲染和交互过程中频繁的实例查找
   * 可以直接在 AOM 内部完成，无需绕经 BoardCore。
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
   * @type {import("./board-core.js").BoardCore}
   */
  board;

  /**
   * AOM 渲染钩子
   * @description 注入式渲染钩子，替代直接访问 board.viewports / viewport.renderer。
   * @type {import("./aom-render-hooks.js").AomRenderHooks}
   */
  renderHooks;

  /**
   * 区块加载器 id 池
   * @type {RandomNumberPool}
   */
  chunkLoaderIdPool;

  /**
   * @param {import("./board-core.js").BoardCore} [board] - 所属白板实例
   * @param {{ renderHooks?: import("./aom-render-hooks.js").AomRenderHooks }} [options={}] - 附加选项
   */
  constructor(board, options = {}) {
    this.board = board;
    this.renderHooks = options.renderHooks ?? createDefaultAomRenderHooks();
    this.layerPool = new RandomNumberPool(1, 10000000);
    this.chunkLoaderIdPool = new RandomNumberPool(1, 10000000);
    this.layerOrder = [];
    this.onLayer = new Map();
    this.layerIndex = new Map();
    this.activeObjectIndex = new Map();
    this.baseObjectSnapshotWorldRanges = new Map();
    this.baseObjectSnapshotCoverChunks = new Map();
  }

  /**
   * 记录对象进入活动层前的世界范围快照
   * @param {Iterable<BasicObject>} [objects = []] - 待记录对象集合
   * @private
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
   * @private
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
   * @private
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
   * @private
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
   * @private
   */
  registerActiveObject(obj) {
    this.requireObjectInstance(obj);
    this.activeObjectIndex.set(obj.id, obj);
  }

  /**
   * 请求所有 viewport 刷新活动层
   * @description 通过 `renderHooks` 委托给 UI 侧实际渲染管线。
   * @param {Iterable<BasicObject>} [objects = []] - 受影响对象集合
   * @private
   */
  requestActiveRender(objects = []) {
    const changedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );
    this.renderHooks.requestActiveRender(changedObjects);
  }

  /**
   * 请求所有 viewport 刷新静态层
   * @description 通过 `renderHooks` 委托给 UI 侧实际渲染管线。
   * @private
   */
  requestStaticRender(chunks = []) {
    const normalizedChunks = Array.from(chunks).filter(Boolean);
    this.renderHooks.requestStaticRender(normalizedChunks);
  }

  /**
   * 请求所有 viewport 按对象范围刷新静态层
   * @description 通过 `renderHooks` 委托给 UI 侧实际渲染管线。
   * @param {Iterable<BasicObject>} [objects = []] - 受影响对象集合
   * @param {Iterable<Chunk>} [fallbackChunks = []] - 无法走对象级失效时的回退区块集合
   * @private
   */
  requestStaticRenderForObjects(objects = [], fallbackChunks = []) {
    const normalizedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );
    const normalizedChunks = Array.from(fallbackChunks).filter(Boolean);
    const previousWorldRects = new Map(this.baseObjectSnapshotWorldRanges);

    this.renderHooks.requestStaticRenderForObjects(
      normalizedObjects,
      normalizedChunks,
      previousWorldRects,
    );
  }

  /**
   * 解析静态层对象级失效集合
   * @param {Iterable<BasicObject>} [objects = []] - 起始对象集合
   * @param {Array<{ coveredChunkIds: Set<number>, relatedObjectIds?: Iterable<number> }>} [contexts = []] - 关联上下文
   * @returns {BasicObject[]}
   * @private
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
   * @private
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
   * @private
   */
  unregisterTrackedActiveObject(objectId) {
    if (this.activeObjectIndex.has(objectId)) {
      this.activeObjectIndex.delete(objectId);
    }
  }

  /**
   * 按当前全局活动对象索引刷新层的活动状态
   * @param {Layer | undefined} layer - 目标层
   * @returns {boolean}
   * @private
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
   * @private
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
   * @private
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
   * @private
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

      if (hasRemainingTrackedActiveObjects) {
        for (const objectId of objectIds) {
          this.unregisterTrackedActiveObject(objectId);
          if (this.onLayer.get(objectId) === layer) {
            this.onLayer.delete(objectId);
          }
          layer.activeObjects.delete(objectId);
        }
        layer.active = true;
        continue;
      }

      // 整层失活：保留对象实例以便 tidyup 写入静态图
      if (!layer._dormantInstances) {
        layer._dormantInstances = new Map();
      }
      for (const entry of objects ?? []) {
        const objectInstance = this.requireObjectInstance(entry);
        if (objectIds.has(objectInstance.id)) {
          layer._dormantInstances.set(objectInstance.id, objectInstance);
        }
      }
      for (const objectId of objectIds) {
        this.unregisterTrackedActiveObject(objectId);
      }
      layer.active = false;
    }
  }

  /**
   * 解析对象起始区块
   * @param {BasicObject} obj
   * @returns {Chunk | undefined}
   * @private
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
   * @description 请在使用完区块加载器后调用 {@link destroyChunkLoader} 方法，以释放资源并回收 id。
   * @returns {ChunkLoader | undefined}
   * @private
   */
  createChunkLoader() {
    if (this.board?.createChunkLoader) {
      return this.board.createChunkLoader(
        `aom-${this.chunkLoaderIdPool.generate()}`,
      );
    }
    return undefined;
  }

  /**
   * 销毁区块加载器
   * @description 请在使用完区块加载器后调用该方法，以释放资源并回收 id。
   * @param {ChunkLoader} loader - 由 {@link createChunkLoader} 创建的区块加载器
   * @private
   */
  destroyChunkLoader(loader) {
    let requestId = loader?.requesterId;
    loader?.destroy?.();
    let id = parseInt(requestId?.replace(/^aom-/, ""));
    this.chunkLoaderIdPool.remove(id);
  }

  /**
   * 获取对象世界坐标范围
   * @param {BasicObject} obj - 要获取世界坐标范围的对象实例
   * @returns {Range | undefined} 对象的世界坐标范围，若无法获取则返回 undefined
   * @private
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
   * @private
   */
  findBoardObjectInstance(objectId, candidateChunkIds = []) {
    const activeObject = this.activeObjectIndex.get(objectId);
    if (activeObject instanceof BasicObject) {
      return activeObject;
    }

    // 在失活层中查找暂存的对象实例
    for (const layer of this.layerOrder) {
      const dormant = layer._dormantInstances?.get(objectId);
      if (dormant instanceof BasicObject) {
        return dormant;
      }
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
   * @private
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
   * @private
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
   * @private
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
   * @private
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
   * @private
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
        if (nodeId === obj.id) continue;
        // 同层且在 applyingObjectIds 中的对象，由下方 applyingObjectIds 循环
        // 以同层无边的语义统一处理，避免此处按 inactive 语义添加 above 边形成环路。
        // 跨层对象不受影响，仍按 index 比较确定 below/above。
        if (applyingObjectIds.has(nodeId) && index === currentLayerIndex)
          continue;
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
   * @description 遍历静态图边和覆盖区块索引，跨区块时 TempLoad 目标区块再继续遍历。
   * @param {Iterable<BasicObject>} startFrom - 作为起点的对象集合
   * @returns {Promise<DirectedGraph>}
   * @private
   */
  async pickup(startFrom) {
    const visit = new Set();
    const graph = new DirectedGraph();

    /**
     * 已加载区块的节点队列
     * @description 元素类型为 `{ nodeId: number, chunk: Chunk }`
     */
    const loadedQueue = new Queue();

    /**
     * 需等待区块加载的节点队列
     * @description 元素类型为 `{ nodeId: number, chunk: Chunk }`
     */
    const pendingQueue = new Queue();

    // 创建一个临时加载器，供本次拾取中所有跨区块加载复用
    const loader = this.createChunkLoader();

    /**
     * 从 chunk 的 staticGraph 中读取 node 的邻接对象，
     * 将未访问的按区块加载状态分入 loadedQueue 或 pendingQueue
     * @param {number} nodeId
     * @param {Chunk} chunk
     * @returns {void}
     */
    const enqueueNeighbors = (nodeId, chunk) => {
      if (!chunk?.objectManager) return;
      const neighbors = chunk.objectManager.staticGraph.neighborsUnsafe(nodeId);
      if (!neighbors) return;
      for (const next of neighbors) {
        if (!visit.has(next)) {
          visit.add(next);
          graph.addNodeUnsafe(next);
          const targetQueue = chunk.isLoad ? loadedQueue : pendingQueue;
          targetQueue.push({ nodeId: next, chunk });
        }
        graph.addEdgeUnsafe(nodeId, next);
      }
    };

    // 初始化队列：将起点对象按加载状态分入
    for (const entry of startFrom) {
      const obj = this.requireObjectInstance(entry);
      const chunk = this.resolveObjectChunk(obj);
      if (!chunk || visit.has(obj.id)) continue;
      visit.add(obj.id);
      graph.addNodeUnsafe(obj.id);
      const targetQueue = chunk.isLoad ? loadedQueue : pendingQueue;
      targetQueue.push({ nodeId: obj.id, chunk });
    }

    // BFS：优先处理已加载区块，攒够未加载的统一批量加载
    while (!loadedQueue.empty() || !pendingQueue.empty()) {
      // loadedQueue 耗尽时，批量加载 pendingQueue 中所有未加载区块
      if (loadedQueue.empty() && !pendingQueue.empty()) {
        const unloadedIds = [
          ...new Set(
            pendingQueue
              .toArray()
              .filter((item) => item.chunk && !item.chunk.isLoad)
              .map((item) => item.chunk.id),
          ),
        ];
        await Promise.all(
          unloadedIds.map(async (chunkId) => {
            const chunk = this.board.getChunkById(chunkId);
            if (!chunk || chunk.isLoad) return;
            loader.trackChunk(chunk);
            loader.emitLoadRequest(chunk, { strategy: "temp" });
            await new Promise((resolve) => {
              this.board.chunkLoadEventBus.once(
                CHUNK_LOAD_EVENTS.LOAD_COMPLETE,
                (payload) => {
                  if (payload.chunkId === chunkId) resolve();
                },
              );
            });
          }),
        );
        // 全部移入 loadedQueue
        while (!pendingQueue.empty()) loadedQueue.push(pendingQueue.pop());
      }

      const { nodeId, chunk: currentChunk } = loadedQueue.pop();
      if (!currentChunk?.objectManager) continue;

      // 读取当前区块中的邻接对象
      enqueueNeighbors(nodeId, currentChunk);

      // 读取覆盖区块中的邻接对象
      const coveredIds =
        currentChunk.objectManager.getObjectCoverChunks(nodeId);
      for (const coveredId of coveredIds) {
        if (coveredId === currentChunk.id) continue;
        const coveredChunk = this.board.getChunkById(coveredId);
        if (!coveredChunk) continue;
        enqueueNeighbors(nodeId, coveredChunk);
      }
    }

    this.destroyChunkLoader(loader);
    return graph;
  }

  /**
   * 选取非活动对象并加入活动对象管理器
   * @description
   * 通过 pickup 提取子图，按层依赖关系为对象分配动态层，
   * 再将新层插入到 layerOrder 中的正确位置。
   * @param {Iterable<BasicObject>} startFrom - 要选择的对象集合
   * @returns {Promise<void>}
   */
  async choose(startFrom) {
    // 提取出这些对象所构成的子图
    // 随后遍历子图，按拓扑序 + 活动对象优先级分配层索引
    let graph = await this.pickup(startFrom);
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

    this.requestActiveRender(activeEntries);
    // 对象已从静态图被拾取到 AOM，需要按对象范围重绘静态层，
    // 让 ViewportRenderer 的静态缓存通过 AOM 过滤将它们从缓存层中隐藏，避免整视口重绘。
    this.requestStaticRenderForObjects(activeEntries);
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
    this.requestStaticRenderForObjects(newObjectEntries);
    this.requestActiveRender(newObjectEntries);
    return newLayer;
  }

  /**
   * 批量将多个层的对象全部写入静态图
   * @description
   * 将多个层的 activeObjects 合并在同一三阶段流水线中处理：
   * Phase 1 添加节点、Phase 2 清边、Phase 3 计算关系并写边。
   * 批量处理避免层间 Phase 2 清边互相覆盖。
   * @param {Layer[]} layers - 待提交的层集合（仅处理 activeObjects）
   * @returns {Set<number>} 受影响的区块 id 集合
   * @private
   */
  _writeLayersToBoard(layers) {
    if (!this.board || !Array.isArray(layers) || layers.length === 0) {
      return new Set();
    }

    // 收集所有层的对象——仅收集 activeObjects 中已失活的对象。
    // inactiveGraph 中的对象原本已在静态图中，作为层上下文保留，
    // 不需要通过 _writeLayersToBoard 重新写入。
    const allObjects = [];
    const allObjectIds = new Set();
    for (const layer of layers) {
      const dormantInstances = layer._dormantInstances ?? new Map();
      for (const objectId of layer.activeObjects) {
        if (allObjectIds.has(objectId)) continue;
        const objectInstance =
          dormantInstances.get(objectId) ??
          this.findBoardObjectInstance(objectId);
        if (objectInstance instanceof BasicObject) {
          allObjects.push(objectInstance);
          allObjectIds.add(objectId);
        }
      }
    }
    if (allObjects.length === 0) return new Set();

    return this._writeObjectsToBoard(allObjects, allObjectIds);
  }

  /**
   * 将对象集合写入静态图的覆盖区块
   * @description 供 {@link _writeLayersToBoard} 和 {@link apply} 的活动路径复用。
   * @param {BasicObject[]} objects - 待写入的对象集合
   * @param {Set<number>} allObjectIds - 本次提交涉及的全部对象 id，用于 {@link calculateStaticRelations} 去除同批对象防止形成环路
   * @returns {Set<number>} 受影响的区块 id 集合
   * @private
   */
  _writeObjectsToBoard(objects, allObjectIds) {
    const affectedChunkIds = new Set();
    if (
      !this.board ||
      !Array.isArray(objects) ||
      objects.length === 0 ||
      !(allObjectIds instanceof Set)
    ) {
      return affectedChunkIds;
    }

    // 确保所有对象在覆盖区块中存在（不设边）
    for (const obj of objects) {
      const ownerChunk = this.resolveObjectChunk(obj);
      const coveredChunkIds = this.calculateCoveredChunkIds(obj);
      for (const chunkId of coveredChunkIds) {
        affectedChunkIds.add(chunkId);
      }
      for (const chunkId of coveredChunkIds) {
        const chunk = this.board.getChunkById(chunkId);
        if (!chunk) continue;
        chunk.addObject(chunkId === ownerChunk?.id ? obj : obj.id);
        this.board?.setObjectCoverChunks?.(obj.id, coveredChunkIds);
      }
    }

    // 清除所有对象在覆盖区块中的旧边
    for (const obj of objects) {
      const coveredChunkIds = this.calculateCoveredChunkIds(obj);
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

    // 按层间关系计算并写入静态图上下关系
    for (const obj of objects) {
      const coveredChunkIds = this.calculateCoveredChunkIds(obj);
      const ownerChunk = this.resolveObjectChunk(obj);
      const { below, above } = this.calculateStaticRelations(
        obj,
        coveredChunkIds,
        allObjectIds,
        { includeUntrackedCoveredObjectsBelow: true },
      );
      for (const chunkId of coveredChunkIds) {
        const chunk = this.board.getChunkById(chunkId);
        if (!chunk) continue;
        chunk.addObject(
          chunkId === ownerChunk?.id ? obj : obj.id,
          [...below],
          [...above],
        );
        this.board?.setObjectCoverChunks?.(obj.id, coveredChunkIds);
      }
    }

    return affectedChunkIds;
  }

  /**
   * 清理动态图
   * @description
   * 删除最下面一个 active 层之下的所有 inactive 层，并清理空层。
   * 若当前已不存在 active 层，则删除全部层。
   * 清理 inactive 层时，会先将该层对象写入静态图。
   * @private
   */
  tidyup() {
    // 收集最下面一个 active 层之下的所有 inactive 层，
    // 批量写入静态图后再清理层映射与空层。
    let count = 0;
    const purgingLayers = [];
    for (const layer of this.layerOrder) {
      if (layer.active) break;
      purgingLayers.push(layer);
      count++;
    }
    if (purgingLayers.length > 0) {
      const commitLayers = purgingLayers.filter(
        (layer) => layer._shouldCommitToBoard === true,
      );
      if (commitLayers.length > 0) {
        this._writeLayersToBoard(commitLayers);
      }
      for (const layer of purgingLayers) {
        this.purgeLayerMappings(layer);
        layer.clear();
      }
    }
    this.layerOrder.splice(0, count);

    // 清理 layerIndex 以便后续 rebuild 从干净的起点开始
    this.layerIndex.clear();

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
   * 操作前 FullLoad 所有相关区块，使 calculateStaticRelations 能正确读取已有对象。
   * @param {Iterable<BasicObject>} objects
   * @returns {Promise<void>}
   */
  async apply(objects) {
    const normalizedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );

    const canCommitToBoard = Boolean(this.board);
    const commitObjects = [...normalizedObjects];
    const activeBasicObjects = [...normalizedObjects];
    const affectedChunkIds = new Set();

    // 预加载所有相关区块（FullLoad），确保 calculateStaticRelations 能读取已有对象实例
    if (canCommitToBoard && activeBasicObjects.length > 0) {
      const boardRootPath = this.board.resolvePersistenceRootPath?.();
      const preloadChunkIds = new Set();
      for (const obj of activeBasicObjects) {
        const worldRange = this.getObjectWorldRange(obj);
        if (worldRange && this.board.width > 0 && this.board.height > 0) {
          const coveredIds =
            ChunkObjectManager.calculateCoveredChunkIdsForRange(
              worldRange,
              this.board.width,
              this.board.height,
            );
          for (const id of coveredIds) preloadChunkIds.add(id);
        } else {
          const chunkId = Chunk.worldToChunkId(
            obj.position,
            this.board.width,
            this.board.height,
          );
          if (chunkId != null) preloadChunkIds.add(chunkId);
        }
      }
      if (boardRootPath && preloadChunkIds.size > 0) {
        const loader = this.createChunkLoader();
        const loadPromises = [];
        for (const chunkId of preloadChunkIds) {
          const chunk = this.board.getChunkById(chunkId);
          if (!chunk || (chunk.isLoad && !chunk.isTempLoad)) continue;
          loader.trackChunk(chunk);
          loader.emitLoadRequest(chunk, { strategy: "full" });
          // 通过 LOAD_COMPLETE 事件等待加载完成
          const promise = new Promise((resolve) => {
            const unsub = this.board.chunkLoadEventBus.once(
              CHUNK_LOAD_EVENTS.LOAD_COMPLETE,
              (payload) => {
                if (payload.chunkId === chunkId) resolve();
              },
            );
          });
          loadPromises.push(promise);
        }
        await Promise.all(loadPromises);
        // 延时销毁：保留已预加载区块，短时间内后续 apply 可复用缓存
        loader?.destroy(300);
      }
    }

    // 将对象对应层失活——先于静态图写入执行，
    // 确保层变为 inactive 后该层 active set 中的对象不再进入静态图。
    // 在失活前为当前涉及的各层标记 _shouldCommitToBoard，
    // 使 tidyup 清理时能区分 apply（需写入静态图）与 discard（不写入）。
    for (const objectInstance of commitObjects) {
      const layer = this.onLayer.get(objectInstance.id);
      if (layer instanceof Layer) {
        layer._shouldCommitToBoard = true;
      }
    }
    this.deactivateObjects(commitObjects);
    this.tidyup();

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

      // 从不再覆盖的旧区块中移除对象——对所有待提交对象执行，
      // 无论其所在层是否即将变为 inactive。此步骤只清理静态图中的节点，
      // 不调用 chunk.removeObject 以避免副作用清除 board 级覆盖索引。
      for (const {
        obj,
        previousCoveredChunkIds,
        coveredChunkIds,
      } of applyContexts) {
        for (const staleChunkId of previousCoveredChunkIds) {
          if (coveredChunkIds.has(staleChunkId)) continue;
          const staleChunk = this.board.getChunkById(staleChunkId);
          if (!staleChunk?.objectManager) continue;
          const staleGraph = staleChunk.objectManager.staticGraph;
          if (staleGraph.hasNode(obj.id)) {
            staleGraph.deleteNodeUnsafe(obj.id);
          }
        }
      }

      // 仅对所在层仍为 active 的对象执行静态图写入。
      // 所在层 inactive（已被 deactivateObjects 失活且未被 tidyup 清理）的对象
      // 将留到后续 tidyup 清理该层时再写入——这避免了对象同时在静态图与 AOM
      // inactive 层中出现，导致 base 层与 live 层重复渲染。
      // 若对象已不在任何层中（已被 tidyup 清理），说明已通过 _writeLayersToBoard
      // 写入静态图，应跳过避免 Phase 2 清边覆盖已写入的关系。
      const activeLayerContexts = applyContexts.filter((ctx) => {
        const layer = this.onLayer.get(ctx.obj.id);
        if (!layer) return false;
        return layer.active;
      });

      // 对仍在 active 层的对象，通过 _writeObjectsToBoard 写入静态图
      if (activeLayerContexts.length > 0) {
        this._writeObjectsToBoard(
          activeLayerContexts.map((ctx) => ctx.obj),
          applyingObjectIds,
        );
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

    // 请求静态缓存层刷新
    this.requestStaticRenderForObjects(
      activeBasicObjects,
      [...affectedChunkIds]
        .map((chunkId) => this.board?.getChunkById?.(chunkId))
        .filter(Boolean),
    );
    this.requestActiveRender(normalizedObjects);
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

    // 请求静态缓存层和活动层刷新
    this.requestStaticRenderForObjects(
      normalizedObjects,
      [...affectedChunkIds]
        .map((chunkId) => this.board?.getChunkById?.(chunkId))
        .filter(Boolean),
    );
    this.requestActiveRender(normalizedObjects);
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
    this.requestStaticRenderForObjects(normalizedObjects);
    this.requestActiveRender(normalizedObjects);
    this.clearBaseObjectSnapshots(normalizedObjects);
  }

  /**
   * 判断指定的对象是否当前在 AOM 中（不论活跃与否）
   * @param {number} objectId - 指定的对象 id
   * @returns {boolean}
   */
  has(objectId) {
    return this.onLayer.has(objectId);
  }

  /**
   * 清理给定层的 `onLayer` 映射和 `layerPool`
   * @param {Layer} layer - 要清理的层
   * @private
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
   * @private
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
   * @private
   */
  insertLayerToTop(layerNow) {
    this.insertLayerUnderById(layerNow, undefined);
  }

  /**
   * 比较两层的层次顺序（用 id 表示）
   * @param {number | undefined} layer1 - 层 1 的 id
   * @param {number | undefined} layer2 - 层 2 的 id
   * @returns {number} 若层 1 在层 2 之上则返回正数，若层 1 在层 2 之下则返回负数，若二者相等则返回 0
   * @private
   */
  compareLayerOrderById(layer1, layer2) {
    if (layer1 === layer2) return 0;
    if (layer1 === undefined) return 1;
    if (layer2 === undefined) return -1;
    return this.layerIndex.get(layer1) - this.layerIndex.get(layer2);
  }

}

export { ActiveObjectManager, Layer };
