/**
 * @file 渲染器基类
 * @description 提供视口变换、脏区裁剪与渲染调度的通用抽象。
 * @module canvas/renderer
 * @author Zhou Chenyu
 */

import { BasicObject } from "../../kernel/objects/basic-obj.js";
import { intersectsRanges, RectangleRange } from "../../kernel/range/index.js";
import { PathRange } from "../../kernel/range/path.js";
import { createRectangleDirtyRectMerger } from "./render-scheduler.js";
import { CanvasHost } from "./canvas-lifecycle.js";
import { drawObject } from "./object-draw-strategies.js";

const PATH_RASTERIZATION_SCREEN_PADDING = 1;

/**
 * 用于 clearRect 时对脏区做整数扩边，避免子像素残留
 * @param {RectangleRange | Object} rect - 原始脏区
 * @returns {RectangleRange | undefined}
 */
function expandRectForClear(rect) {
  const normalizedRect = RectangleRange.fromRectLike(rect);
  if (!normalizedRect) return undefined;

  const left = Math.floor(normalizedRect.left);
  const top = Math.floor(normalizedRect.top);
  const right = Math.ceil(normalizedRect.right);
  const bottom = Math.ceil(normalizedRect.bottom);

  return new RectangleRange(left, top, right - left, bottom - top);
}

/**
 * 规整脏区数组用于屏幕清理：扩边 + 过滤无效项
 * @param {any[]} [dirtyRects = []]
 * @returns {RectangleRange[]}
 */
function normalizeDirtyRectsForScreenUpdate(dirtyRects = []) {
  return dirtyRects
    .map((dirtyRect) => expandRectForClear(dirtyRect))
    .filter(Boolean);
}

/**
 * 判断矩形是否为退化矩形
 * @description 渲染包围盒未被计算时是零矩形；此时必须回退到主判定范围，
 * 否则对象会被当作零面积而漏绘、漏失效。
 * @param {RectangleRange} rect - 待测矩形
 * @returns {boolean} 是否为退化矩形
 */
function isDegenerateRect(rect) {
  return !(rect.width > 0) && !(rect.height > 0);
}

/**
 * 渲染器基类
 * @description 封装视口坐标变换、脏区清理、裁剪渲染与渲染调度的通用逻辑。
 * 子类需实现 clear 抽象方法并可按需重写 _getThresholds 钩子。
 * @class
 * @author Zhou Chenyu
 */
class Renderer extends CanvasHost {
  /**
   * 远程手势预览坐标覆盖表（对象 id → 预览位置）
   * @description 只影响渲染视图，不改对象数据；渲染时临时覆盖 position 后还原。
   * @type {Map<string, { x: number, y: number }>}
   * @private
   */
  #previewPositions = new Map();

  /**
   * @param {import("../../kernel/types/types.js").ViewportLike} viewport - 目标视口
   * @param {{ canvas?: HTMLCanvasElement | null }} [options = {}] - 初始化选项
   */
  constructor(viewport, options = {}) {
    super(viewport, options);
  }

  /**
   * 设置对象的预览坐标（远程手势中间帧；渲染时覆盖 position）
   * @param {string} objectId - 对象 id
   * @param {{ x: number, y: number }} position - 预览位置
   * @returns {void}
   */
  setPreviewPosition(objectId, position) {
    if (typeof position?.x !== "number" || typeof position?.y !== "number") {
      return;
    }
    this.#previewPositions.set(objectId, { x: position.x, y: position.y });
  }

  /**
   * 清除对象的预览坐标（手势终点或记录归位后）
   * @param {string} objectId - 对象 id
   * @returns {void}
   */
  clearPreviewPosition(objectId) {
    this.#previewPositions.delete(objectId);
  }

  /**
   * 清空全部预览坐标（断线时对端手势状态不可信）
   * @returns {void}
   */
  clearAllPreviewPositions() {
    this.#previewPositions.clear();
  }

  /**
   * 取对象的预览坐标（渲染覆盖用）
   * @param {string} objectId - 对象 id
   * @returns {{ x: number, y: number } | undefined} 预览位置
   * @protected
   */
  _getPreviewPosition(objectId) {
    return this.#previewPositions.get(objectId);
  }

  /**
   * 创建脏区合并器
   * @returns {(dirtyRects: any[]) => any[]}
   * @protected
   */
  _createDirtyRectMerger() {
    return createRectangleDirtyRectMerger({
      getThresholds: () => this._getThresholds(),
      getViewportRect: () => this._getViewportRect(),
    });
  }

  /**
   * 获取当前脏区合并阈值
   * @returns {Record<string, number | undefined>}
   * @protected
   */
  _getThresholds() {
    return {};
  }

  /**
   * 获取视口矩形
   * @returns {RectangleRange | undefined}
   * @protected
   */
  _getViewportRect() {
    return this.viewport?.getViewportScreenRect?.();
  }

  /**
   * 全量清空画布
   * @protected
   */
  clear() {
    throw new Error("Not implemented: clear");
  }

  /**
   * 获取对象的世界矩形范围
   * @description
   * 优先取渲染包围盒：它已在几何变更时算好，取用是 O(1)。
   * 若改回走 `getRange()`，笔画会因此逐点复制整条路径，
   * 而本方法在每次重建中对每个对象都要调一次。
   * 旧对象或外部传入的测试替身可能没有 `getRenderBounds()`，此时回退到主判定范围。
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectWorldRect(objectInstance) {
    try {
      const renderBounds = objectInstance?.getRenderBounds?.();
      if (renderBounds && !isDegenerateRect(renderBounds)) {
        return RectangleRange.fromRectLike(
          renderBounds.withPosition(objectInstance.position),
        );
      }

      const worldRange = objectInstance
        ?.getRange?.()
        ?.withPosition?.(objectInstance.position);
      if (!worldRange) return undefined;
      return RectangleRange.from(worldRange);
    } catch {
      // 渲染期对象可能处于 teardown 中间态（range/position 暂缺），按无范围处理
      return undefined;
    }
  }

  /**
   * 获取对象的屏幕留白
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {number} 屏幕空间留白
   */
  getObjectScreenPadding(objectInstance) {
    const objectPadding = objectInstance?.getRenderPadding?.();
    const basePadding =
      Number.isFinite(objectPadding) && objectPadding > 0
        ? objectPadding * (this.viewport?.zoom ?? 1)
        : 0;
    const objectRange = objectInstance?.getRange?.();

    if (objectRange instanceof PathRange) {
      return basePadding + PATH_RASTERIZATION_SCREEN_PADDING;
    }

    return basePadding;
  }

  /**
   * 获取对象的屏幕矩形范围
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectScreenRect(objectInstance) {
    const worldRect = this.getObjectWorldRect(objectInstance);
    if (!worldRect) return undefined;

    const screenRect = this.viewport?.worldRectToScreenRect?.(worldRect);
    if (!screenRect) return undefined;

    return screenRect.inflate(this.getObjectScreenPadding(objectInstance));
  }

  /**
   * 规范化屏幕矩形
   * @param {RectangleRange | { left: number, top: number, width?: number, height?: number, right?: number, bottom?: number }} rect - 原始矩形
   * @returns {RectangleRange | undefined}
   */
  normalizeScreenRect(rect) {
    return RectangleRange.fromRectLike(rect);
  }

  /**
   * 创建 drawable 条目
   * @param {BasicObject[]} drawables - 对象实例集合
   * @returns {Array<{ objectId: string, object: BasicObject, screenRect?: RectangleRange }>}
   */
  createDrawableEntries(drawables) {
    return drawables.map((objectInstance) => ({
      objectId: objectInstance.id,
      object: objectInstance,
      screenRect: this.getObjectScreenRect(objectInstance),
    }));
  }

  /**
   * 收集待处理脏区
   * @param {Array<RectangleRange | { left: number, top: number, width?: number, height?: number, right?: number, bottom?: number }>} [dirtyRects = []] - 外部传入脏区
   * @returns {RectangleRange[]}
   */
  collectDirtyRects(dirtyRects = []) {
    return dirtyRects
      .map((rect) => this.normalizeScreenRect(rect))
      .filter(Boolean);
  }

  /**
   * 判断对象条目是否与任一脏区相交
   * @param {{ screenRect?: RectangleRange }} entry - drawable 条目
   * @param {RectangleRange[]} dirtyRects - 脏区集合
   * @returns {boolean}
   */
  intersectsDirtyRects(entry, dirtyRects) {
    const rect = entry?.screenRect;
    if (!rect) return dirtyRects.length === 0;

    return dirtyRects.some((dirtyRect) => intersectsRanges(rect, dirtyRect));
  }

  /**
   * 收集与条目相交的脏区
   * @param {{ screenRect?: RectangleRange }} entry - drawable 条目
   * @param {RectangleRange[]} dirtyRects - 脏区集合
   * @returns {RectangleRange[]} 相交脏区
   */
  getEntryDirtyRects(entry, dirtyRects) {
    const rect = entry?.screenRect;
    if (!rect) return dirtyRects;

    return dirtyRects.filter((dirtyRect) => intersectsRanges(rect, dirtyRect));
  }

  /**
   * 清理脏区
   * @param {RectangleRange[]} dirtyRects - 脏区集合
   */
  clearDirtyRects(dirtyRects) {
    const ctx = this._getContext();
    if (!ctx) return;

    for (const dirtyRect of dirtyRects) {
      const clearRect = expandRectForClear(dirtyRect);
      if (!clearRect) continue;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(
        clearRect.left,
        clearRect.top,
        clearRect.width,
        clearRect.height,
      );
      ctx.restore();
    }
  }

  /**
   * 在指定脏区裁剪下渲染对象
   * @param {CanvasRenderingContext2D} ctx - 原始 2D 上下文
   * @param {CanvasRenderingContext2D} viewportContext - 视口上下文
   * @param {BasicObject} objectInstance - 待绘制对象
   * @param {RectangleRange[]} dirtyRects - 裁剪脏区
   */
  renderObjectWithinDirtyRects(
    ctx,
    viewportContext,
    objectInstance,
    dirtyRects,
  ) {
    if (!Array.isArray(dirtyRects) || dirtyRects.length === 0) {
      drawObject(viewportContext, objectInstance);
      return;
    }

    const clipRects = dirtyRects
      .map((dirtyRect) => RectangleRange.fromRectLike(dirtyRect))
      .filter(Boolean);

    if (clipRects.length === 0) {
      drawObject(viewportContext, objectInstance);
      return;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (const clipRect of clipRects) {
      ctx.rect(clipRect.left, clipRect.top, clipRect.width, clipRect.height);
    }

    ctx.clip();
    drawObject(viewportContext, objectInstance);
    ctx.restore();
  }

  /**
   * 将世界坐标变换折算到屏幕坐标
   * @description
   * 返回一个把 `setTransform` 折叠进视口缩放与平移的上下文替身。
   * 方法表在构建时从原上下文上一次性绑定，之后每次调用都是直接函数调用；
   * 不使用 `Proxy`，因为 Proxy 的每次属性读取都要重新 `bind` 一个新函数,
   * 而属性读取发生在绘制策略的点循环内，点越多代价越高。
   * 属性写入与读取经访问器转发到原上下文，避免样式设置滞留在替身上。
   * @param {CanvasRenderingContext2D} ctx - 原始 2D 上下文
   * @returns {CanvasRenderingContext2D} 视口上下文
   */
  createViewportContext(ctx) {
    const viewport = this.viewport;
    const zoom = viewport?.zoom ?? 1;
    const originX = viewport?.origin?.x ?? 0;
    const originY = viewport?.origin?.y ?? 0;

    const viewportContext = {};
    const visitedNames = new Set();

    for (
      let source = ctx;
      source && source !== Object.prototype;
      source = Object.getPrototypeOf(source)
    ) {
      for (const name of Object.getOwnPropertyNames(source)) {
        if (name === "constructor" || visitedNames.has(name)) continue;
        visitedNames.add(name);

        const descriptor = Object.getOwnPropertyDescriptor(source, name);
        if (!descriptor) continue;

        if (typeof descriptor.value === "function") {
          viewportContext[name] = descriptor.value.bind(ctx);
          continue;
        }

        Object.defineProperty(viewportContext, name, {
          enumerable: true,
          configurable: true,
          get: () => ctx[name],
          set: (value) => {
            ctx[name] = value;
          },
        });
      }
    }

    // 覆盖绑定后的 setTransform，叠上视口缩放与平移
    viewportContext.setTransform = (a, b, c, d, e, f) =>
      ctx.setTransform(
        a * zoom,
        b * zoom,
        c * zoom,
        d * zoom,
        (e - originX) * zoom,
        (f - originY) * zoom,
      );

    return viewportContext;
  }
}

export { Renderer, expandRectForClear, normalizeDirtyRectsForScreenUpdate };
