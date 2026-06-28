/**
 * @file Uniform Board API
 * @description
 * 提供 BoardApi 接口的同线程实现，直接调用 BoardCore 的同步/异步方法。
 * P2 阶段保持同步封装（createObject 返回 Promise.resolve(id) 而非真实异步），
 * P3 切为 RPC 实现后保持相同方法签名。
 * @module core/bridges/board-api
 * @author Zhou Chenyu
 */

import { BoardCore } from "../components/orchestration/board-core.js";
import { deserialize } from "../objects/object-deserializer.js";
import { Matrix, Vector } from "../utils/math.js";
import { intersectsRanges, RectangleRange } from "../range/index.js";

/**
 * BoardApi 同线程实现
 * @class
 * @description
 * 封装 BoardCore 实例，以 Promise 形态暴露 BoardApi 接口。
 * 工具通过此 API 以 objectId 令牌交互，不再持有 BasicObject 实例引用。
 * P2 阶段同线程直调 BoardCore 同步方法；P3 切换为 RPC 版本后保持签名不变。
 * @author Zhou Chenyu
 */
class BoardApi {
  /**
   * BoardCore 实例引用
   * @type {BoardCore}
   */
  #boardCore;

  /**
   * @param {BoardCore} boardCore - BoardCore 实例
   */
  constructor(boardCore) {
    this.#boardCore = boardCore;
  }

  /**
   * 获取被包装的 BoardCore 实例
   * @returns {BoardCore}
   */
  getBoardCore() {
    return this.#boardCore;
  }

  /**
   * 在 Core 侧创建对象实例，注册到 AOM 动态图
   * @param {string} type - 对象类型名（如 "StrokeObject" | "CircleObject"）
   * @param {Record<string, any>} props - 创建属性（含 position、property、对象级几何标量）
   * @returns {Promise<number>} 新对象的 objectId
   * @throws {TypeError} 不支持的对象类型或缺少 id
   */
  async createObject(type, props) {
    const objectId = this.#boardCore.allocateObjectId();
    const obj = deserialize({
      type,
      id: objectId,
      position: props?.position ?? { x: 0, y: 0 },
      transform: { a: 1, b: 0, c: 0, d: 1 },
      property: { ...(props?.property ?? {}) },
      data: { ...(props?.data ?? {}) },
    });

    this.#boardCore.addObject(obj);
    this.#boardCore.activeObjectManager.add(new Set([obj]));

    return objectId;
  }

  /**
   * 修改单个对象的几何/样式属性
   * @param {number} objectId - 对象 id
   * @param {import("../shared/board-api-types.js").ObjectPatch} patch - 修改 patch
   * @returns {Promise<void>}
   * @throws {Error} 对象不存在时抛出
   */
  async modifyObject(objectId, patch) {
    const obj = this.#boardCore.getObjectById(objectId);
    if (!obj) {
      throw new Error(`Object ${objectId} not found.`);
    }

    // 应用 position 变更
    if (patch.position != null) {
      const { x, y } = patch.position;
      obj.position = new Vector(x, y);
    }

    // 应用 transform 变更
    if (patch.transform != null) {
      const { a, b, c, d } = patch.transform;
      obj.setTransform(new Matrix(a, b, c, d));
    }

    // 应用 property 合并
    if (patch.property != null) {
      obj.setProperty(patch.property);
    }

    // 应用 data（类型专属几何数据，如 radius、points 等标量/结构变更）
    if (patch.data != null) {
      obj.setData(patch.data);
    }

    // 通过 AOM render hooks 触发活动层脏区刷新
    const aomRenderHooks = this.#boardCore.aomRenderHooks;
    if (aomRenderHooks?.requestLiveRender) {
      aomRenderHooks.requestLiveRender([obj]);
    }
  }

  /**
   * 批量修改多个对象
   * @param {import("../shared/board-api-types.js").ObjectPatchEntry[]} patches - 批量 patch
   * @returns {Promise<void>}
   */
  async modifyObjects(patches) {
    if (!Array.isArray(patches) || patches.length === 0) return;

    // 按 objectId 合并同帧内对同一对象的多次 patch，减少重复查找与渲染
    const merged = new Map();
    for (const { objectId, patch } of patches) {
      if (objectId == null || !patch) continue;
      const existing = merged.get(objectId);
      if (existing) {
        if (patch.position != null) existing.position = patch.position;
        if (patch.transform != null) existing.transform = patch.transform;
        if (patch.property != null) {
          existing.property = {
            ...(existing.property ?? {}),
            ...patch.property,
          };
        }
        if (patch.data != null) {
          existing.data = { ...(existing.data ?? {}), ...patch.data };
        }
      } else {
        merged.set(objectId, { ...patch });
      }
    }

    // 逐对象应用合并后的 patch，统一触发脏区
    const changedObjects = [];
    for (const [objectId, mergedPatch] of merged) {
      const obj = this.#boardCore.getObjectById(objectId);
      if (!obj) continue;

      if (mergedPatch.position != null) {
        const { x, y } = mergedPatch.position;
        obj.position = new Vector(x, y);
      }
      if (mergedPatch.transform != null) {
        const { a, b, c, d } = mergedPatch.transform;
        obj.setTransform(new Matrix(a, b, c, d));
      }
      if (mergedPatch.property != null) {
        obj.setProperty(mergedPatch.property);
      }
      if (mergedPatch.data != null) {
        obj.setData(mergedPatch.data);
      }
      changedObjects.push(obj);
    }

    if (changedObjects.length > 0) {
      const aomRenderHooks = this.#boardCore.aomRenderHooks;
      if (aomRenderHooks?.requestLiveRender) {
        aomRenderHooks.requestLiveRender(changedObjects);
      }
    }
  }

  /**
   * 向对象的列表属性追加元素
   * @param {number} objectId - 对象 id
   * @param {string} key - 列表属性名（如 "points"）
   * @param {any[]} items - 追加的元素集合
   * @returns {Promise<void>}
   */
  async appendListItem(objectId, key, items) {
    const obj = this.#boardCore.getObjectById(objectId);
    if (!obj) return;

    obj.appendListItem(key, ...items);

    const aomRenderHooks = this.#boardCore.aomRenderHooks;
    if (aomRenderHooks?.requestLiveRender) {
      aomRenderHooks.requestLiveRender([obj]);
    }
  }

  /**
   * 替换对象列表属性中指定索引的元素
   * @param {number} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @param {any} item - 新元素
   * @returns {Promise<void>}
   */
  async replaceListItem(objectId, key, index, item) {
    const obj = this.#boardCore.getObjectById(objectId);
    if (!obj) return;

    obj.replaceListItem(key, index, item);

    const aomRenderHooks = this.#boardCore.aomRenderHooks;
    if (aomRenderHooks?.requestLiveRender) {
      aomRenderHooks.requestLiveRender([obj]);
    }
  }

  /**
   * 删除对象列表属性中指定索引的元素
   * @param {number} objectId - 对象 id
   * @param {string} key - 列表属性名
   * @param {number} index - 目标索引
   * @returns {Promise<void>}
   */
  async removeListItem(objectId, key, index) {
    const obj = this.#boardCore.getObjectById(objectId);
    if (!obj) return;

    obj.removeListItem(key, index);

    const aomRenderHooks = this.#boardCore.aomRenderHooks;
    if (aomRenderHooks?.requestLiveRender) {
      aomRenderHooks.requestLiveRender([obj]);
    }
  }

  /**
   * 永久删除对象集合
   * @param {number[]} objectIds - 要删除的对象 id 列表
   * @returns {Promise<void>}
   */
  async deleteObjects(objectIds) {
    if (!Array.isArray(objectIds) || objectIds.length === 0) return;

    const aom = this.#boardCore.activeObjectManager;
    const activeToDiscard = [];
    const affectedChunks = new Set();

    for (const objectId of objectIds) {
      const obj = this.#boardCore.getObjectById(objectId);
      if (!obj) continue;

      // 收集 AOM 活动对象，后续批量 discard
      if (aom?.activeObjectIndex?.has?.(objectId)) {
        activeToDiscard.push(obj);
      }

      // 从所有已加载区块的静态图中移除
      for (const { chunk } of this.#boardCore.chunkLoaded.values()) {
        if (chunk?.objectManager?.staticGraph?.hasNode?.(objectId)) {
          chunk.removeObject(objectId);
          affectedChunks.add(chunk);
        }
      }

      // 从白板级对象注册表中删除
      this.#boardCore.objectLoaded.delete(objectId);
    }

    // 批量 discard AOM 活动对象
    if (activeToDiscard.length > 0) {
      aom.discard(new Set(activeToDiscard));
    }

    // 刷新受影响区块的 base render
    if (affectedChunks.size > 0) {
      const renderHooks = this.#boardCore.aomRenderHooks;
      if (renderHooks?.requestBaseRender) {
        renderHooks.requestBaseRender([...affectedChunks]);
      }
    }
  }

  /**
   * 将 AOM 动态图中的对象写回静态图
   * @param {number[]} objectIds - 要提交的对象 id 列表
   * @returns {Promise<void>}
   */
  async commitObjects(objectIds) {
    if (!Array.isArray(objectIds) || objectIds.length === 0) return;

    const objects = objectIds
      .map((id) => this.#boardCore.getObjectById(id))
      .filter(Boolean);
    if (objects.length === 0) return;

    this.#boardCore.activeObjectManager.apply(new Set(objects));
  }

  /**
   * 将对象加入 AOM 动态图
   * @param {number[]} objectIds - 对象 id 列表
   * @returns {Promise<void>}
   */
  async addActiveObjects(objectIds) {
    if (!Array.isArray(objectIds) || objectIds.length === 0) return;

    const objects = objectIds
      .map((id) => this.#boardCore.getObjectById(id))
      .filter(Boolean);
    if (objects.length === 0) return;

    // 静态图中已有对象走 choose 语义，沿对象依赖图做分层接管
    this.#boardCore.activeObjectManager.choose(new Set(objects));
  }

  /**
   * 将对象从 AOM 动态图移除
   * @param {number[]} objectIds - 对象 id 列表
   * @returns {Promise<void>}
   */
  async discardActiveObjects(objectIds) {
    if (!Array.isArray(objectIds) || objectIds.length === 0) return;

    const objects = objectIds
      .map((id) => this.#boardCore.getObjectById(id))
      .filter(Boolean);
    if (objects.length === 0) return;

    this.#boardCore.activeObjectManager.discard(new Set(objects));
  }

  /**
   * 按 id 查询对象摘要（合并视图：AOM 动态对象遮蔽同 id 的静态对象）
   * @param {number[]} ids - 对象 id 列表
   * @returns {Promise<import("../shared/types.js").ObjectSummary[]>} 对象摘要列表
   */
  async queryObjects(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];

    const aom = this.#boardCore.activeObjectManager;
    const summaries = [];

    for (const objectId of ids) {
      const obj = this.#boardCore.getObjectById(objectId);
      if (!obj) continue;

      const isActive = aom?.activeObjectIndex?.has?.(objectId) ?? false;
      summaries.push({
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
      });
    }

    return summaries;
  }

  /**
   * 按区块查询对象 id
   * @param {number[]} chunkIds - 区块 id 列表
   * @returns {Promise<number[]>} 对象 id 列表
   */
  async queryChunkObjects(chunkIds) {
    if (!Array.isArray(chunkIds) || chunkIds.length === 0) return [];

    const seen = new Set();

    for (const chunkId of chunkIds) {
      const chunk = this.#boardCore.getChunkById(chunkId);
      if (!chunk?.objectManager?.staticGraph) continue;

      for (const objectId of chunk.objectManager.staticGraph.getNodes()) {
        seen.add(objectId);
      }
    }

    return [...seen];
  }

  /**
   * 在合并视图上执行命中查询
   * @param {import("../range/range.js").Range | import("./types.js").Rect} range - 命中范围
   * @param {string} [mode] - 命中模式
   * @returns {Promise<number[]>} 命中的 objectId 列表
   */
  async hitTest(range, mode) {
    // 规整查询范围
    let queryRange;
    if (range instanceof RectangleRange) {
      queryRange = range;
    } else if (typeof range?.left === "number") {
      queryRange = RectangleRange.fromRectLike(range);
    } else {
      queryRange = range;
    }
    if (!queryRange) return [];

    // 遍历所有已加载对象做空间相交判定
    const hits = [];
    for (const [objectId] of this.#boardCore.objectLoaded) {
      const obj = this.#boardCore.getObjectById(objectId);
      if (!obj) continue;

      const worldRange = obj.getRange()?.withPosition?.(obj.position);
      if (!worldRange) continue;

      if (intersectsRanges(worldRange, queryRange)) {
        hits.push(objectId);
      }
    }

    return hits;
  }

  /**
   * 在 Core 侧创建 MonitorCore 实例
   * @param {import("../shared/board-api-types.js").CreateMonitorOptions} options - 创建参数
   * @returns {Promise<void>}
   */
  async createMonitor(options) {
    // TODO(P3): 创建 MonitorCore（含 OffscreenCanvas、BaseRenderer、LiveRenderer）
    throw new Error("Not implemented yet.");
  }

  /**
   * 销毁 Core 侧的 MonitorCore 实例
   * @param {string | number} monitorId - monitor 标识
   * @returns {Promise<void>}
   */
  async destroyMonitor(monitorId) {
    // TODO(P3): 释放 MonitorCore 及其 OffscreenCanvas
    throw new Error("Not implemented yet.");
  }

  /**
   * 执行撤销
   * @returns {Promise<void>}
   */
  async undo() {
    // TODO(P3+): 委托给 BoardCore.undoTree
    throw new Error("Not implemented yet.");
  }

  /**
   * 执行重做
   * @returns {Promise<void>}
   */
  async redo() {
    // TODO(P3+): 委托给 BoardCore.undoTree
    throw new Error("Not implemented yet.");
  }
}

export { BoardApi };
