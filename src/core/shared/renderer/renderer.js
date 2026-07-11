/**
 * @file 渲染器基类
 * @description 提供视口变换、脏区裁剪、渲染调度与渲染管线骨架的通用抽象。
 * @module core/shared/renderer/renderer
 * @author Zhou Chenyu
 */

import { BasicObject } from "../objects/basic-obj.js";
import { intersectsRanges, RectangleRange } from "../range/index.js";
import { PathRange } from "../range/path.js";
import { createRectangleDirtyRectMerger } from "./render-scheduler.js";
import { CanvasHost } from "./canvas-lifecycle.js";

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
 * 渲染器基类
 * @description 封装视口坐标变换、脏区清理、裁剪渲染与渲染调度的通用逻辑。
 * 子类需实现 clear、_collectDrawables 抽象方法并可按需重写
 * _beforeRender、_afterClear、_afterRender、_getThresholds、_getCanonicalRectsForRect 钩子。
 * @class
 * @author Zhou Chenyu
 */
class Renderer extends CanvasHost {
  /**
   * @param {import("../../ui/components/orchestration/viewport.js").Viewport} viewport - 目标视口
   * @param {{ canvas?: HTMLCanvasElement | null }} [options = {}] - 初始化选项
   */
  constructor(viewport, options = {}) {
    super(viewport, options);
  }

  /**
   * 初始化渲染调度器
   * @description 子类在完成自身构造后调用，确保阈值策略等依赖已就位。
   * @protected
   */
  _initScheduler() {
    super._initScheduler(this._createDirtyRectMerger(), (dirtyRects) =>
      this.flush(dirtyRects),
    );
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
      getCanonicalRectsForRect: (dirtyRect) =>
        this._getCanonicalRectsForRect(dirtyRect),
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
   * 获取脏区对应的 canonical rect 集合
   * @param {any} dirtyRect - 脏区
   * @returns {any[]}
   * @protected
   */
  _getCanonicalRectsForRect(dirtyRect) {
    return [];
  }

  /**
   * 收集应绘制的对象集合
   * @returns {BasicObject[]}
   * @protected
   */
  _collectDrawables() {
    throw new Error("Not implemented: _collectDrawables");
  }

  /**
   * 全量清空画布
   * @protected
   */
  clear() {
    throw new Error("Not implemented: clear");
  }

  /**
   * 在收集 drawable 之前执行的钩子
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @protected
   */
  _beforeRender(ctx) {
    // 默认空实现
  }

  /**
   * 在清理之后、绘制对象之前执行的钩子
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {boolean} hasExplicitDirtyRects - 是否有显式脏区
   * @param {RectangleRange[]} effectiveDirtyRects - 有效脏区
   * @protected
   */
  _afterClear(ctx, hasExplicitDirtyRects, effectiveDirtyRects) {
    // 默认空实现
  }

  /**
   * 在绘制完成之后执行的钩子
   * @param {BasicObject[]} drawables - 已绘制的对象
   * @param {Array<{ objectId: number, object: BasicObject, screenRect?: RectangleRange }>} drawableEntries - drawable 条目
   * @protected
   */
  _afterRender(drawables, drawableEntries) {
    // 默认空实现
  }

  /**
   * 获取对象的世界矩形范围
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectWorldRect(objectInstance) {
    try {
      const worldRange = objectInstance
        ?.getRange?.()
        ?.withPosition?.(objectInstance.position);
      if (!worldRange) return undefined;
      return RectangleRange.from(worldRange);
    } catch {
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
   * @returns {Array<{ objectId: number, object: BasicObject, screenRect?: RectangleRange }>}
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
      objectInstance.render(viewportContext);
      return;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (const dirtyRect of dirtyRects) {
      ctx.rect(
        dirtyRect.left,
        dirtyRect.top,
        dirtyRect.width,
        dirtyRect.height,
      );
    }
    ctx.clip();
    objectInstance.render(viewportContext);
    ctx.restore();
  }

  /**
   * 将世界坐标变换折算到屏幕坐标
   * @param {CanvasRenderingContext2D} ctx - 原始 2D 上下文
   * @returns {CanvasRenderingContext2D}
   */
  createViewportContext(ctx) {
    const viewport = this.viewport;
    const zoom = viewport?.zoom ?? 1;
    const originX = viewport?.origin?.x ?? 0;
    const originY = viewport?.origin?.y ?? 0;

    return new Proxy(ctx, {
      get(target, prop, receiver) {
        if (prop === "setTransform") {
          return (a, b, c, d, e, f) => {
            const translatedE = (e - originX) * zoom;
            const translatedF = (f - originY) * zoom;
            return target.setTransform(
              a * zoom,
              b * zoom,
              c * zoom,
              d * zoom,
              translatedE,
              translatedF,
            );
          };
        }

        const value = Reflect.get(target, prop, target);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },

      set(target, prop, value) {
        return Reflect.set(target, prop, value, target);
      },
    });
  }

  /**
   * 渲染管线模板方法
   * @description
   * 方法骨架：
   * 1. _beforeRender     — 渲染前准备工作
   * 2. _collectDrawables — 子类决定从何处收集对象
   * 3. clear / clearDirtyRects — 清空画布
   * 4. _afterClear       — 清空后绘制前的工作（例如合成缓存层）
   * 5. 遍历 drawable     — 脏区裁剪 + 渲染
   * 6. _afterRender      — 渲染后收尾（例如保存上一帧缓存）
   * @param {Array<RectangleRange>} [dirtyRects] - 可选的屏幕脏区集合
   * @returns {BasicObject[]} 当前渲染的对象集合
   */
  render(dirtyRects) {
    const ctx = this._getContext();
    if (!ctx) return [];

    this._beforeRender(ctx);

    const drawables = this._collectDrawables();
    const drawableEntries = this.createDrawableEntries(drawables);
    const viewportContext = this.createViewportContext(ctx);
    const hasExplicitDirtyRects =
      Array.isArray(dirtyRects) && dirtyRects.length > 0;
    const effectiveDirtyRects = hasExplicitDirtyRects
      ? normalizeDirtyRectsForScreenUpdate(this.collectDirtyRects(dirtyRects))
      : [];

    if (hasExplicitDirtyRects) {
      this.clearDirtyRects(effectiveDirtyRects);
    } else {
      this.clear();
    }

    this._afterClear(ctx, hasExplicitDirtyRects, effectiveDirtyRects);

    for (const entry of drawableEntries) {
      if (hasExplicitDirtyRects) {
        if (!this.intersectsDirtyRects(entry, effectiveDirtyRects)) continue;
      }
      if (typeof entry.object.render !== "function") continue;

      const entryDirtyRects = hasExplicitDirtyRects
        ? this.getEntryDirtyRects(entry, effectiveDirtyRects)
        : [];

      this.renderObjectWithinDirtyRects(
        ctx,
        viewportContext,
        entry.object,
        entryDirtyRects,
      );
    }

    this._afterRender(drawables, drawableEntries);

    return drawables;
  }

  /**
   * 刷新入口
   * @param {Array<RectangleRange>} [dirtyRects] - 可选的屏幕脏区集合
   * @returns {BasicObject[]} 当前渲染的对象集合
   */
  flush(dirtyRects) {
    return this.render(dirtyRects);
  }
}

export { Renderer, expandRectForClear, normalizeDirtyRectsForScreenUpdate };
