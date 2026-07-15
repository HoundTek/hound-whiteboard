/**
 * @file Engine Board API
 * @description
 * BoardApi 是 Engine 侧的统一领域分发层。
 * 接收 BoardCore 实例，提供对象 CRUD、AOM 操作、查询和命中检测等方法的直接实现。
 * 与 RPC 客户端（bridges/board-api-rpc.js）共享同一契约签名。
 * @module core/engine/api/board-api
 * @author Zhou Chenyu
 */

import { deserialize } from "../objects/object-deserializer.js";
import { Matrix, Vector } from "../utils/math.js";
import { intersectsRanges, RectangleRange } from "../range/index.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { CHUNK_LOAD_EVENTS } from "../chunk/chunk-loader.js";

/**
 * 判断对象是否已进入 Worker 侧的区块静态图
 * @param {import("../orchestration/board-core.js").BoardCore} boardCore - BoardCore 实例
 * @param {number} objectId - 对象 id
 * @returns {boolean}
 */
function hasStaticBoardObject(boardCore, objectId) {
  for (const { chunk } of boardCore.chunkLoaded.values()) {
    if (chunk?.objectManager?.staticGraph?.hasNode?.(objectId)) {
      return true;
    }
  }
  return false;
}

/**
 * Engine 侧 BoardApi
 * @class
 * @description
 * 直连 BoardCore 的领域 API 实现。所有方法同步执行（除 hitTest 因区块加载需要异步），
 * 不依赖 PostMessage 或 Worker 传输。
 * 方法签名与 {@link ../../types/board-api-types.js} 定义的 BoardApi 契约一致。
 * @author Zhou Chenyu
 */
class BoardApi {
  /**
   * BoardCore 实例
   * @type {import("../orchestration/board-core.js").BoardCore}
   */
  #boardCore;

  /**
   * @param {import("../orchestration/board-core.js").BoardCore} boardCore - BoardCore 实例
   */
  constructor(boardCore) {
    this.#boardCore = boardCore;
  }

  /**
   * 在 Engine 侧创建对象实例，注册到 AOM 动态图
   * @param {string} type - 对象类型名
   * @param {import("../../types/board-api-types.js").CreateObjectProps} props - 创建属性
   * @returns {number} 新对象的 objectId
   */
  createObject(type, props) {
    const boardCore = this.#boardCore;
    const objectId = props?.id;
    if (objectId == null) {
      throw new Error("createObject requires an explicit object id.");
    }
    const existingObject = boardCore.getObjectById(objectId);
    if (existingObject) {
      throw new Error(
        `Duplicate object id ${objectId}: an object with this id already exists.`,
      );
    }

    const obj = deserialize({
      type,
      id: objectId,
      position: props?.position ?? { x: 0, y: 0 },
      transform: { a: 1, b: 0, c: 0, d: 1 },
      property: { ...(props?.property ?? {}) },
      data: { ...(props?.data ?? {}) },
    });

    boardCore.registerObjectInstance(obj);
    boardCore.activeObjectManager.add(new Set([obj]));

    return objectId;
  }

  /**
   * 修改单个对象的几何/样式属性
   * @param {number} objectId - 对象 id
   * @param {import("../../types/board-api-types.js").ObjectPatch} patch - 修改 patch
   * @returns {void}
   */
  modifyObject(objectId, patch) {
    const boardCore = this.#boardCore;
    const obj = boardCore.getObjectById(objectId);
    if (!obj) {
      throw new Error(`Object ${objectId} not found.`);
    }

    if (patch.position != null) {
      obj.position = new Vector(patch.position.x, patch.position.y);
    }
    if (patch.transform != null) {
      const { a, b, c, d } = patch.transform;
      obj.setTransform(new Matrix(a, b, c, d));
    }
    if (patch.property != null) {
      obj.setProperty(patch.property);
    }
    if (patch.data != null) {
      obj.setData(patch.data);
    }

    boardCore.aomRenderHooks?.requestActiveRender?.([obj]);
  }

  /**
   * 批量修改多个对象
   * @param {import("../../types/board-api-types.js").ObjectPatchEntry[]} patches - 批量 patch
   * @returns {void}
   */
  modifyObjects(patches) {
    const boardCore = this.#boardCore;
    const items = Array.isArray(patches) ? patches : [];
    const modifiedObjects = [];

    for (const { objectId, patch } of items) {
      if (objectId == null || !patch) continue;
      const obj = boardCore.getObjectById(objectId);
      if (!obj) continue;

      if (patch.position != null) {
        obj.position = new Vector(patch.position.x, patch.position.y);
      }
      if (patch.transform != null) {
        const { a, b, c, d } = patch.transform;
        obj.setTransform(new Matrix(a, b, c, d));
      }
      if (patch.property != null) {
        obj.setProperty(patch.property);
      }
      if (patch.data != null) {
        obj.setData(patch.data);
      }
      modifiedObjects.push(obj);
    }

    if (modifiedObjects.length > 0) {
      boardCore.aomRenderHooks?.requestActiveRender?.(modifiedObjects);
    }
  }

  /**
   * 向对象的列表属性追加元素
   * @param {number} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {any[]} items - 追加的元素集合
   * @returns {void}
   */
  appendListItem(objectId, key, items) {
    const boardCore = this.#boardCore;
    const obj = boardCore.getObjectById(objectId);
    if (obj) {
      obj.appendListItem(key, ...(items ?? []));
      boardCore.aomRenderHooks?.requestActiveRender?.([obj]);
    }
  }

  /**
   * 替换对象列表属性中指定索引的元素
   * @param {number} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @param {any} item - 新元素
   * @returns {void}
   */
  replaceListItem(objectId, key, index, item) {
    const boardCore = this.#boardCore;
    const obj = boardCore.getObjectById(objectId);
    if (obj) {
      obj.replaceListItem(key, index, item);
      boardCore.aomRenderHooks?.requestActiveRender?.([obj]);
    }
  }

  /**
   * 删除对象列表属性中指定索引的元素
   * @param {number} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @returns {void}
   */
  removeListItem(objectId, key, index) {
    const boardCore = this.#boardCore;
    const obj = boardCore.getObjectById(objectId);
    if (obj) {
      obj.removeListItem(key, index);
      boardCore.aomRenderHooks?.requestActiveRender?.([obj]);
    }
  }

  /**
   * 永久删除对象集合
   * @param {number[]} objectIds - 要删除的对象 id 列表
   * @returns {void}
   */
  deleteObjects(objectIds) {
    const boardCore = this.#boardCore;
    const ids = Array.isArray(objectIds) ? objectIds : [];
    const aom = boardCore.activeObjectManager;
    const activeToDiscard = [];
    const affectedChunks = new Set();

    for (const objectId of ids) {
      const obj = boardCore.getObjectById(objectId);
      if (!obj) continue;

      if (aom?.activeObjectIndex?.has?.(objectId)) {
        activeToDiscard.push(obj);
      }

      for (const { chunk } of boardCore.chunkLoaded.values()) {
        if (chunk?.objectManager?.staticGraph?.hasNode?.(objectId)) {
          chunk.removeObject(objectId);
          affectedChunks.add(chunk);
        }
      }

      boardCore.objectLoaded.delete(objectId);
    }

    if (activeToDiscard.length > 0) {
      aom.discard(new Set(activeToDiscard));
    }

    if (
      affectedChunks.size > 0 &&
      boardCore.aomRenderHooks?.requestStaticRender
    ) {
      boardCore.aomRenderHooks.requestStaticRender([...affectedChunks]);
    }
  }

  /**
   * 将 AOM 动态图中的对象写回静态图
   * @param {number[]} objectIds - 要提交的对象 id 列表
   * @returns {import("../../types/types.js").ApplyResult=} 提交结果
   */
  commitObjects(objectIds) {
    const boardCore = this.#boardCore;
    const ids = Array.isArray(objectIds) ? objectIds : [];
    const objects = ids
      .map((id) => boardCore.getObjectById(id))
      .filter(Boolean);
    if (objects.length > 0) {
      return boardCore.activeObjectManager.apply(new Set(objects));
    }
  }

  /**
   * 将对象加入 AOM 动态图
   * @param {number[]} objectIds - 对象 id 列表
   * @returns {void}
   */
  addActiveObjects(objectIds) {
    const boardCore = this.#boardCore;
    const ids = Array.isArray(objectIds) ? objectIds : [];
    const objects = ids
      .map((id) => boardCore.getObjectById(id))
      .filter(Boolean);
    if (objects.length > 0) {
      boardCore.activeObjectManager.choose(new Set(objects));
    }
  }

  /**
   * 将对象从 AOM 动态图移除
   * @param {number[]} objectIds - 对象 id 列表
   * @returns {void}
   */
  discardActiveObjects(objectIds) {
    const boardCore = this.#boardCore;
    const ids = Array.isArray(objectIds) ? objectIds : [];
    const objects = ids
      .map((id) => boardCore.getObjectById(id))
      .filter(Boolean);

    const transientObjectIds = objects.filter(
      (obj) => !hasStaticBoardObject(boardCore, obj.id),
    );

    boardCore.activeObjectManager.discard(new Set(objects));

    for (const objectId of transientObjectIds) {
      boardCore.objectLoaded.delete(objectId);
    }
  }

  /**
   * 按 id 查询对象摘要
   * @param {number[]} ids - 对象 id 列表
   * @returns {import("../../types/types.js").ObjectSummary[]} 对象摘要列表
   */
  queryObjects(ids) {
    const boardCore = this.#boardCore;
    const idList = Array.isArray(ids) ? ids : [];
    const aom = boardCore.activeObjectManager;

    return idList
      .map((objectId) => {
        const obj = boardCore.getObjectById(objectId);
        if (!obj) return null;
        const isActive = aom?.activeObjectIndex?.has?.(objectId) ?? false;
        return {
          id: obj.id,
          type: obj.constructor.name,
          isActive,
          position: { x: obj.position.x, y: obj.position.y },
          transform: obj.transform
            ? {
                a: obj.transform.a,
                b: obj.transform.b,
                c: obj.transform.c,
                d: obj.transform.d,
              }
            : undefined,
          boundingBox: obj.rich?.boundingBox,
          range: obj.getRange(),
          property: { ...(obj.property ?? {}) },
          data: { ...(obj.data ?? {}) },
        };
      })
      .filter(Boolean);
  }

  /**
   * 按区块查询对象 id
   * @param {number[]} chunkIds - 区块 id 列表
   * @returns {number[]} 对象 id 列表
   */
  queryChunkObjects(chunkIds) {
    const boardCore = this.#boardCore;
    const ids = Array.isArray(chunkIds) ? chunkIds : [];
    const seen = new Set();

    for (const chunkId of ids) {
      const chunk = boardCore.getChunkById(chunkId);
      if (!chunk?.objectManager?.staticGraph) continue;
      for (const objectId of chunk.objectManager.staticGraph.getNodes()) {
        seen.add(objectId);
      }
    }

    return [...seen];
  }

  /**
   * 在合并视图上执行命中查询
   * @param {import("../../range/range.js").Range | import("../../types/types.js").Rect} range - 命中范围
   * @param {string} [mode] - 命中模式
   * @returns {Promise<number[]>} 命中的 objectId 列表
   */
  async hitTest(range, mode) {
    const boardCore = this.#boardCore;

    let queryRange;
    if (range instanceof RectangleRange) {
      queryRange = range;
    } else if (typeof range?.left === "number") {
      queryRange = RectangleRange.fromRectLike(range);
    } else {
      queryRange = range;
    }
    if (!queryRange) return [];

    return this.#collectHitObjects(boardCore, queryRange);
  }

  /**
   * 收集与查询范围相交的对象 id
   * @description
   * 若查询范围覆盖未加载或仅临时加载的区块，会先 FullLoad 使对象实例就绪，
   * 执行命中检测后销毁 loader 释放引用。
   * @param {import("../orchestration/board-core.js").BoardCore} boardCore - BoardCore 实例
   * @param {RectangleRange} queryRange - 查询范围
   * @returns {Promise<number[]>} 命中的对象 id 列表
   * @private
   */
  async #collectHitObjects(boardCore, queryRange) {
    if (
      boardCore.width > 0 &&
      boardCore.height > 0 &&
      typeof queryRange.left === "number"
    ) {
      const chunkIds = ChunkObjectManager.calculateCoveredChunkIdsForRange(
        queryRange,
        boardCore.width,
        boardCore.height,
      );
      const chunksToLoad = [...chunkIds]
        .map((id) => boardCore.getChunkById(id))
        .filter((chunk) => chunk && (chunk.isTempLoad || !chunk.isLoad));

      if (chunksToLoad.length > 0) {
        const loader = boardCore.createChunkLoader(
          `hit-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        );
        for (const chunk of chunksToLoad) {
          loader.trackChunk(chunk);
          loader.emitLoadRequest(chunk, { strategy: "full" });
          await new Promise((resolve) => {
            const handler = (payload) => {
              if (payload.chunkId === chunk.id) {
                boardCore.chunkLoadEventBus.off(
                  CHUNK_LOAD_EVENTS.LOAD_COMPLETE,
                  handler,
                );
                resolve();
              }
            };
            boardCore.chunkLoadEventBus.on(
              CHUNK_LOAD_EVENTS.LOAD_COMPLETE,
              handler,
            );
          });
        }

        const hits = this.#runHitTest(boardCore, queryRange, chunkIds);
        loader.destroy(300);
        return hits;
      }

      return this.#runHitTest(boardCore, queryRange, chunkIds);
    }

    return this.#runHitTest(boardCore, queryRange);
  }

  /**
   * 在当前已加载对象中执行命中检测
   * @param {import("../orchestration/board-core.js").BoardCore} boardCore - BoardCore 实例
   * @param {RectangleRange} queryRange - 查询范围
   * @param {Set<number>} [chunkIds] - 查询范围覆盖的区块 id 集合，用于粗筛
   * @returns {number[]}
   * @private
   */
  #runHitTest(boardCore, queryRange, chunkIds) {
    const hits = [];

    for (const [objectId] of boardCore.objectLoaded) {
      const obj = boardCore.getObjectById(objectId);
      if (!obj) continue;

      if (chunkIds) {
        const coverChunks = boardCore.getObjectCoverChunks(objectId);
        if (coverChunks && !this.#chunkSetsOverlap(coverChunks, chunkIds)) {
          continue;
        }
      }

      const worldRange = obj.getRange()?.withPosition?.(obj.position);
      if (!worldRange) continue;

      if (intersectsRanges(worldRange, queryRange)) {
        hits.push(objectId);
      }
    }

    return hits;
  }

  /**
   * 判断两个区块 id 集合是否有交集
   * @param {Set<number>} a - 集合 a
   * @param {Set<number>} b - 集合 b
   * @returns {boolean}
   * @private
   */
  #chunkSetsOverlap(a, b) {
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const id of smaller) {
      if (larger.has(id)) return true;
    }
    return false;
  }

  /**
   * 执行撤销
   * @returns {void}
   * @throws {Error} 尚未实现
   */
  undo() {
    throw new Error("Undo not implemented yet.");
  }

  /**
   * 执行重做
   * @returns {void}
   * @throws {Error} 尚未实现
   */
  redo() {
    throw new Error("Redo not implemented yet.");
  }
}

export { BoardApi };
