/**
 * @file 全局活动对象管理器
 * @description 管理活动对象的层级、筛选与运行时状态。
 * @module core/components/active-object-manager
 * @author Zhou Chenyu
 */

import { RandomNumberPool } from "../utils/random.js";
import { Queue } from "../utils/queue.js";
import { DirectedGraph } from "../utils/directed-graph.js";
import { Chunk } from "./chunk.js";
import { ChunkBlockLoader } from "./chunk-block-loader.js";
import { ChunkObjectManager } from "./chunk-object-manager.js";
import { BasicObject } from "../objects/basic-obj.js";
import { intersectsRanges, RectangleRange, Range } from "../range/index.js";

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
   * 所属白板
   * @type {import("./board.js").Board | undefined}
   */
  board;

  /**
   * @param {import("./board.js").Board} [board] - 所属白板实例
   */
  constructor(board) {
    this.board = board;
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
   * @param {Iterable<BasicObject>} [objects = []] - 受影响对象集合
   */
  requestLiveRender(objects = []) {
    const board = this.board;
    if (!board?.monitors?.values) return;

    const changedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );

    for (const monitor of board.monitors.values()) {
      const liveRenderer = monitor?.liveRenderer;
      if (!liveRenderer) continue;

      const dirtyObjectMap = new Map();
      for (const objectInstance of changedObjects) {
        dirtyObjectMap.set(objectInstance.id, objectInstance);
      }
      for (const objectInstance of liveRenderer.collectActiveDrawables?.() ??
        []) {
        dirtyObjectMap.set(objectInstance.id, objectInstance);
      }

      if (typeof liveRenderer.invalidateObjects === "function") {
        liveRenderer.invalidateObjects([...dirtyObjectMap.values()]);
      } else {
        monitor?.renderScheduler?.invalidate?.();
      }

      monitor?.requestViewportUiRender?.();
    }
  }

  /**
   * 请求所有 monitor 刷新静态层
   */
  requestBaseRender(chunks = []) {
    const board = this.board;
    if (!board?.monitors?.values) return;

    const normalizedChunks = Array.from(chunks).filter(Boolean);

    for (const monitor of board.monitors.values()) {
      if (normalizedChunks.length > 0) {
        monitor?.baseRenderer?.invalidateChunks?.(normalizedChunks);
        continue;
      }
      if (typeof monitor?.requestViewportBaseRender === "function") {
        monitor.requestViewportBaseRender();
        continue;
      }
      monitor?.baseRenderer?.flush?.();
    }
  }

  /**
   * 请求所有 monitor 按对象范围刷新静态层
   * @param {Iterable<BasicObject>} [objects = []] - 受影响对象集合
   * @param {Iterable<Chunk>} [fallbackChunks = []] - 无法走对象级失效时的回退区块集合
   */
  requestBaseRenderForObjects(objects = [], fallbackChunks = []) {
    const board = this.board;
    if (!board?.monitors?.values) return;

    const normalizedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );
    const normalizedChunks = Array.from(fallbackChunks).filter(Boolean);
    const previousWorldRects = new Map(this.baseObjectSnapshotWorldRanges);

    for (const monitor of board.monitors.values()) {
      const dirtyRects = monitor?.baseRenderer?.invalidateObjects?.(
        normalizedObjects,
        {
          previousWorldRects,
        },
      );

      if (Array.isArray(dirtyRects) && dirtyRects.length > 0) {
        // 对象级失效成功后也要确保视口对应 chunk 缓冲区已同步，
        // 避免 BaseRenderer 在收集静态对象时漏掉跨区块对象所在 chunk。
        monitor?.syncChunkBufferWithViewport?.();
        continue;
      }

      if (normalizedChunks.length > 0) {
        monitor?.baseRenderer?.invalidateChunks?.(normalizedChunks);
        continue;
      }

      if (typeof monitor?.requestViewportBaseRender === "function") {
        monitor.requestViewportBaseRender();
        continue;
      }

      monitor?.baseRenderer?.flush?.();
    }
  }

  /**
   * 刷新能看到指定对象集合的那些 monitor 的静态层
   * @description 为每个对象取世界范围，只 flush 视口与之相交的 monitor。
   *   避免 flush 无关 monitor。
   * @param {Array<BasicObject>} objects - 对象实例数组
   * @private
   */
  _flushViewportForObjects(objects = []) {
    if (!this.board?.monitors?.size) return;

    const worldRanges = objects
      .map((obj) => {
        const range = this.getObjectWorldRange(obj);
        return range ? RectangleRange.from(range) : null;
      })
      .filter(Boolean);

    if (worldRanges.length === 0) return;

    for (const monitor of this.board.monitors.values()) {
      const viewportWorldRect = monitor.getViewportWorldRect?.();
      if (!viewportWorldRect) continue;

      const intersects = worldRanges.some((worldRange) =>
        intersectsRanges(viewportWorldRect, worldRange),
      );
      if (intersects) {
        monitor.flushViewportRender?.();
      }
    }
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
   * 解析对象起始区块
   * @param {BasicObject} obj
   * @returns {Chunk | undefined}
   */
  resolveObjectChunk(obj) {
    this.requireObjectInstance(obj);

    if (Number.isInteger(obj?.ownerChunkId) && this.board) {
      return this.board.getChunkById(obj.ownerChunkId);
    }

    return undefined;
  }

  /**
   * 创建与白板区块加载事件总线绑定的区块加载器
   * @returns {ChunkBlockLoader}
   */
  createChunkBlockLoader() {
    if (this.board?.createChunkBlockLoader) {
      return this.board.createChunkBlockLoader(undefined, `aom-${Date.now()}`);
    }
    return new ChunkBlockLoader();
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
      return new Set(
        Number.isInteger(obj?.ownerChunkId) ? [obj.ownerChunkId] : [],
      );
    }

    const worldRange = this.getObjectWorldRange(obj);
    if (!worldRange || this.board.width <= 0 || this.board.height <= 0) {
      return new Set([obj.ownerChunkId]);
    }

    const chunkIds = ChunkObjectManager.calculateCoveredChunkIdsForRange(
      worldRange,
      this.board.width,
      this.board.height,
    );

    if (chunkIds.size === 0) {
      chunkIds.add(obj.ownerChunkId);
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
   * 计算对象在静态图中的上下关系
   * @description
   * 遍历 AOM 所有层，对每层的非活动对象按层位置确定 below/above：
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

      for (const nodeId of layer.inactiveGraph.getNodes()) {
        const candidate = this.findBoardObjectInstance(nodeId, coveredChunkIds);
        if (!(candidate instanceof BasicObject)) continue;
        if (!this.intersectsObjects(obj, candidate)) continue;

        if (index < currentLayerIndex) {
          relation.below.add(nodeId);
        } else if (index > currentLayerIndex) {
          relation.above.add(nodeId);
        } else {
          // 同层 inactive：pickup 从活动对象出发只沿下游遍历（逆边缘方向），
          // 因此同层 inactive 对象在原始静态图中一定处于活动对象的下游
          // （即放在活动对象之上）。apply 时应恢复为 `above`。
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

      let chunkBlockLoader = this.createChunkBlockLoader();
      // 初始化区块加载器，预加载当前区块
      chunkBlockLoader.initChunk(chunk);

      /**
       * 将区块加载器移动到指定坐标
       * @param {number} targetX - 目标区块坐标 x
       * @param {number} targetY - 目标区块坐标 y
       * @returns {boolean}
       */
      function moveChunkBlockLoaderTo(targetX, targetY) {
        while (
          chunkBlockLoader.chunkNow &&
          chunkBlockLoader.chunkNow.x < targetX
        ) {
          if (!chunkBlockLoader.forceMoveCurrentRightTempLoad()) return false;
        }
        while (
          chunkBlockLoader.chunkNow &&
          chunkBlockLoader.chunkNow.x > targetX
        ) {
          if (!chunkBlockLoader.forceMoveCurrentLeftTempLoad()) return false;
        }
        while (
          chunkBlockLoader.chunkNow &&
          chunkBlockLoader.chunkNow.y < targetY
        ) {
          if (!chunkBlockLoader.forceMoveCurrentUpTempLoad()) return false;
        }
        while (
          chunkBlockLoader.chunkNow &&
          chunkBlockLoader.chunkNow.y > targetY
        ) {
          if (!chunkBlockLoader.forceMoveCurrentDownTempLoad()) return false;
        }

        return (
          chunkBlockLoader.chunkNow?.x === targetX &&
          chunkBlockLoader.chunkNow?.y === targetY
        );
      }

      /**
       * DFS 遍历
       * @description 由于我们的图是薄薄的一层水，所以此处 DFS 不必担心栈溢出的问题。
       * @param {number} node - 对象 id
       */
      function dfs(node) {
        const chunkNow = chunkBlockLoader.chunkNow;
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

          const originalX = chunkBlockLoader.chunkNow.x;
          const originalY = chunkBlockLoader.chunkNow.y;
          const { x: targetX, y: targetY } = Chunk.idToCoordinate(chunkId);
          if (!moveChunkBlockLoaderTo(targetX, targetY)) {
            moveChunkBlockLoaderTo(originalX, originalY);
            continue;
          }

          const neighborsOnTarget =
            chunkBlockLoader.chunkNow.objectManager.staticGraph.neighborsUnsafe(
              node,
            );
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

          moveChunkBlockLoaderTo(originalX, originalY);
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
    // 按对象范围刷新受影响的 monitor：对象已从静态图被拾取到 AOM，
    // 需要让 BaseRenderer 通过 AOM 过滤将它们从静态层中隐藏。
    this._flushViewportForObjects(activeEntries);
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
    this.requestLiveRender(newObjectEntries);
    return newLayer;
  }

  /**
   * 清理动态图
   */
  tidyup() {
    this.layerIndex.clear();

    // 删除无法被访问到的层
    let count = 0;
    for (const layer of this.layerOrder) {
      if (layer.activeObjects.size !== 0) break;
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
    const activeBasicObjects = normalizedObjects;
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

    // 将对象从活动层移除
    for (const entry of normalizedObjects) {
      const objId = entry.id;
      if (!this.activeObjectIndex.has(objId)) {
        continue;
      }
      this.unregisterActiveObject(objId);
    }
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

    // 将对象从活动层移除（仅处理原本就在活动集合中的对象）
    for (const entry of normalizedObjects) {
      const objId = entry.id;
      if (!this.activeObjectIndex.has(objId)) {
        continue;
      }
      this.unregisterActiveObject(objId);
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
   * 仅从动态图活动层中移除对象，不修改区块静态结构。
   * 适合临时取消选择、撤销等不需要同步静态图的场景。
   * 会触发静态层局部重绘，使被丢弃的对象重新在 BaseRenderer 中显示。
   * @param {Iterable<BasicObject>} objects
   */
  discard(objects) {
    const normalizedObjects = Array.from(objects, (item) =>
      this.requireObjectInstance(item),
    );

    for (const entry of normalizedObjects) {
      if (!this.activeObjectIndex.has(entry.id)) {
        continue;
      }
      this.unregisterActiveObject(entry.id);
    }

    this.tidyup();
    this.requestLiveRender(normalizedObjects);
    // 按对象范围刷新受影响的 monitor：对象从 AOM 被丢弃回静态图，
    // 需要让 BaseRenderer 通过 AOM 过滤将它们重新渲染到静态层。
    this._flushViewportForObjects(normalizedObjects);
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
