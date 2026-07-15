/**
 * @file UI 覆盖层渲染器
 * @description 提供 Viewport.uiCanvas 的 overlay 渲染实现，支持脏区增量更新。
 * @module core/ui-thread/components/renderer/ui-renderer
 * @author Zhou Chenyu
 */

import {
  RectangleRange,
  intersectsRanges,
} from "../../../engine/range/index.js";
import { expandRectForClear } from "../../../engine/renderer/renderer.js";
import { Viewport } from "../orchestration/viewport.js";
import { Logger } from "../../../../utils/log/logger.js";
import { logBus } from "../../../../utils/log/log-bus.js";
import { createRectangleDirtyRectMerger } from "../../../engine/renderer/render-scheduler.js";
import { createLiveDirtyRectThresholdStrategy } from "../../../engine/renderer/dirty-rect-strategy-shared.js";
import { CanvasHost } from "../../../engine/renderer/canvas-lifecycle.js";
import { normalizeOverlayEntry as normalizeOverlayEntryFactory } from "./ui-overlay-factory.js";

/**
 * 提取 overlay 条目的屏幕边界矩形，用于脏区相交检测
 * @param {import("./ui-overlay-factory.js").UiOverlayEntry} entry - overlay 条目
 * @returns {RectangleRange | undefined} 边界矩形；无法推导时返回 undefined
 */
function _getOverlayEntryBounds(entry) {
  const g = entry?.geometry;
  if (!g) return undefined;

  if (entry.type === "rect" && g.screenRect) {
    return RectangleRange.fromRectLike(g.screenRect);
  }

  if (entry.type === "point" && g.screenPoint) {
    const r = g.radius ?? 4;
    return new RectangleRange(
      g.screenPoint.x - r,
      g.screenPoint.y - r,
      r * 2,
      r * 2,
    );
  }

  if (
    entry.type === "path" &&
    Array.isArray(g.screenPoints) &&
    g.screenPoints.length > 0
  ) {
    const pts = g.screenPoints;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pt of pts) {
      if (typeof pt.x !== "number" || typeof pt.y !== "number") continue;
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    if (!Number.isFinite(minX)) return undefined;
    const lw = (entry.style?.lineWidth ?? 1) + 2;
    return new RectangleRange(
      minX - lw,
      minY - lw,
      maxX - minX + lw * 2,
      maxY - minY + lw * 2,
    );
  }

  return undefined;
}

/**
 * 判断边界矩形是否与任一脏区相交
 * @param {RectangleRange} bounds - 条目边界矩形
 * @param {RectangleRange[]} dirtyRects - 脏区集合
 * @returns {boolean}
 */
function _intersectsAnyDirtyRect(bounds, dirtyRects) {
  if (!bounds || !Array.isArray(dirtyRects)) return true;

  return dirtyRects.some(
    (dirtyRect) =>
      dirtyRect instanceof RectangleRange &&
      intersectsRanges(bounds, dirtyRect),
  );
}

/**
 * 按脏区清空 context
 * @param {CanvasRenderingContext2D} context - 画布上下文
 * @param {RectangleRange[]} dirtyRects - 脏区集合
 */
function _clearDirtyRects(context, dirtyRects) {
  if (!context || !Array.isArray(dirtyRects)) return;

  for (const dirtyRect of dirtyRects) {
    if (!(dirtyRect instanceof RectangleRange)) continue;
    context.save?.();
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    context.clearRect?.(
      dirtyRect.left,
      dirtyRect.top,
      dirtyRect.width,
      dirtyRect.height,
    );
    context.restore?.();
  }
}

/**
 * UI overlay provider
 * @callback UiOverlayProvider
 * @param {{ viewport: Viewport, renderer: UiRenderer }} context - provider 上下文
 * @returns {import("./ui-overlay-factory.js").UiOverlayEntry | import("./ui-overlay-factory.js").UiOverlayEntry[] | undefined}
 */

/**
 * UI 覆盖层渲染器
 * @description
 * 负责绘制 chooser/modifier 的选择框等 UI 覆盖元素。
 * 自管理 uiCanvas、渲染调度器与脏区合并策略。
 * flush 接收调度器合并后的脏区，仅清空脏区范围并裁剪绘制条目。
 * 不参与 Worker 侧渲染。
 * @class
 * @extends CanvasHost
 * @author Zhou Chenyu
 */
class UiRenderer extends CanvasHost {
  /**
   * 自定义 overlay provider 集合
   * @type {Set<UiOverlayProvider>}
   */
  overlayProviders;

  /**
   * UI 层缩放感知的脏区合并阈值策略
   * @type {(zoom: number) => Record<string, number | undefined>}
   * @private
   */
  _resolveThresholds;

  /**
   * 日志 Logger
   * @type {Logger}
   */
  #log;

  /**
   * @param {Viewport} viewport - 目标视口
   * @param {{ canvas?: HTMLCanvasElement | null }} [options={}] - 初始化选项
   */
  constructor(viewport, options = {}) {
    super(viewport, options);

    this.overlayProviders = new Set();
    this._resolveThresholds = createLiveDirtyRectThresholdStrategy();

    this._initScheduler(
      createRectangleDirtyRectMerger({
        getThresholds: () => this._resolveThresholds(viewport?.zoom ?? 1) ?? {},
        getViewportRect: () => viewport?.getViewportScreenRect?.(),
      }),
      (dirtyRects) => this.flush(dirtyRects),
    );

    /** @type {Logger} */
    this.#log = new Logger("UiRenderer", "WARN", logBus);
  }

  /**
   * 注册自定义 overlay provider
   * @param {UiOverlayProvider} provider - overlay 条目提供函数
   * @returns {UiOverlayProvider | undefined}
   */
  registerOverlayProvider(provider) {
    if (typeof provider !== "function") {
      return undefined;
    }

    this.overlayProviders.add(provider);
    return provider;
  }

  /**
   * 注销自定义 overlay provider
   * @param {UiOverlayProvider} provider - 已注册的 provider
   * @returns {boolean} 是否成功移除
   */
  unregisterOverlayProvider(provider) {
    return this.overlayProviders.delete(provider);
  }

  /**
   * 收集自定义 overlay 条目
   * @description 遍历所有 provider，归一化后合并返回。单个 provider 异常不中断其他 provider 的收集。
   * @returns {import("./ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectProviderOverlayEntries() {
    const overlayEntries = [];
    const drawFns = {
      drawRectEntry: (context, rectEntry) =>
        this.drawRectEntry(context, rectEntry),
      drawPointEntry: (context, pointEntry) =>
        this.drawPointEntry(context, pointEntry),
      drawPathEntry: (context, pathEntry) =>
        this.drawPathEntry(context, pathEntry),
    };

    for (const provider of this.overlayProviders) {
      try {
        const result = provider({
          viewport: this.viewport,
          renderer: this,
        });
        const entries = Array.isArray(result) ? result : [result];

        for (const entry of entries) {
          const normalizedEntry = normalizeOverlayEntryFactory(
            entry,
            this.viewport,
            drawFns,
          );
          if (normalizedEntry) {
            overlayEntries.push(normalizedEntry);
          }
        }
      } catch (error) {
        this.#log.error("Failed to collect ui overlay entries:", error);
      }
    }

    return overlayEntries;
  }

  /**
   * 收集当前应绘制的 overlay
   * @returns {import("./ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectOverlayEntries() {
    return this.collectProviderOverlayEntries();
  }

  /**
   * 绘制矩形 overlay 条目
   * @param {CanvasRenderingContext2D} context - 画布上下文
   * @param {import("./ui-overlay-factory.js").UiOverlayEntry} entry - 矩形条目
   */
  drawRectEntry(context, entry = {}) {
    const g = entry.geometry;
    if (!g?.screenRect) return;

    const screenRect = RectangleRange.fromRectLike(g.screenRect);
    if (!screenRect) return;

    const style = entry.style ?? {};

    context.save?.();
    if (typeof context.setLineDash === "function") {
      context.setLineDash(style.lineDash ?? []);
    }
    if (style.fillStyle !== undefined) {
      context.fillStyle = style.fillStyle;
      context.fillRect?.(
        screenRect.left,
        screenRect.top,
        screenRect.width,
        screenRect.height,
      );
    }
    if (style.strokeStyle !== undefined) {
      context.strokeStyle = style.strokeStyle;
    }
    if (Number.isFinite(style.lineWidth)) {
      context.lineWidth = style.lineWidth;
    }
    context.strokeRect?.(
      screenRect.left,
      screenRect.top,
      screenRect.width,
      screenRect.height,
    );
    context.restore?.();
  }

  /**
   * 绘制点 overlay 条目
   * @description 在 screenPoint 处画一个填充/描边的圆点。
   * @param {CanvasRenderingContext2D} context - 画布上下文
   * @param {import("./ui-overlay-factory.js").UiOverlayEntry} entry - 点条目
   */
  drawPointEntry(context, entry = {}) {
    const g = entry.geometry;
    if (!g?.screenPoint) return;

    const sp = g.screenPoint;
    if (typeof sp.x !== "number" || typeof sp.y !== "number") return;

    const radius = g.radius ?? 4;
    const style = entry.style ?? {};

    context.save?.();
    context.beginPath?.();
    context.arc?.(sp.x, sp.y, radius, 0, Math.PI * 2);
    if (style.fillStyle !== undefined) {
      context.fillStyle = style.fillStyle;
      context.fill?.();
    }
    if (style.strokeStyle !== undefined) {
      context.strokeStyle = style.strokeStyle;
      context.lineWidth = style.lineWidth ?? 1;
      context.stroke?.();
    }
    context.restore?.();
  }

  /**
   * 绘制路径 overlay 条目
   * @description 连接 screenPoints 中的点画一条折线/闭合路径。
   * @param {CanvasRenderingContext2D} context - 画布上下文
   * @param {import("./ui-overlay-factory.js").UiOverlayEntry} entry - 路径条目
   */
  drawPathEntry(context, entry = {}) {
    const g = entry.geometry;
    if (!g?.screenPoints) return;

    const points = g.screenPoints;
    if (!Array.isArray(points) || points.length < 2) return;

    const style = entry.style ?? {};

    context.save?.();
    context.beginPath?.();
    context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      context.lineTo(points[i].x, points[i].y);
    }
    if (g.closePath) {
      context.closePath?.();
    }
    if (typeof context.setLineDash === "function") {
      context.setLineDash(style.lineDash ?? []);
    }
    if (style.strokeStyle !== undefined) {
      context.strokeStyle = style.strokeStyle;
      context.lineWidth = style.lineWidth ?? 1;
      context.stroke?.();
    }
    if (style.fillStyle !== undefined) {
      context.fillStyle = style.fillStyle;
      context.fill?.();
    }
    context.restore?.();
  }

  /**
   * 执行 UI 覆盖层刷新（脏区增量）
   * @description
   * 仅清空脏区范围，跳过不与脏区相交的条目，通过 clip 限制绘制区域。
   * 无显式脏区时回退全量清空+全量绘制。
   * @param {Array<RectangleRange | Object>} [dirtyRects=[]] - 脏区集合
   * @returns {RectangleRange[]} 本次实际处理的脏区
   */
  flush(dirtyRects = []) {
    const context = this._getContext();
    if (!context) return [];

    const viewportRect = this.viewport?.getViewportScreenRect?.();
    if (!viewportRect || viewportRect.width <= 0 || viewportRect.height <= 0) {
      return [];
    }

    const overlayEntries = this.collectOverlayEntries();

    const normalizedDirtyRects =
      Array.isArray(dirtyRects) && dirtyRects.length > 0
        ? dirtyRects.map((rect) => expandRectForClear(rect)).filter(Boolean)
        : [];

    // 只清空脏区（无脏区时全量清空）
    if (normalizedDirtyRects.length > 0) {
      _clearDirtyRects(context, normalizedDirtyRects);
    } else {
      context.clearRect?.(0, 0, viewportRect.width, viewportRect.height);
    }

    if (overlayEntries.length === 0) {
      return normalizedDirtyRects.length > 0
        ? normalizedDirtyRects
        : [viewportRect];
    }

    // 绘制条目：脏区裁剪 + 相交检测
    for (const entry of overlayEntries) {
      const hasDirtyRects = normalizedDirtyRects.length > 0;

      // 有脏区且条目有边界 → 跳过不与任何脏区相交的条目
      const entryBounds = _getOverlayEntryBounds(entry);
      if (
        hasDirtyRects &&
        entryBounds &&
        !_intersectsAnyDirtyRect(entryBounds, normalizedDirtyRects)
      ) {
        continue;
      }

      // 有脏区时 clip 到脏区，避免绘制越界
      if (hasDirtyRects) {
        context.save?.();
        context.setTransform?.(1, 0, 0, 1, 0, 0);
        context.beginPath?.();
        for (const dirtyRect of normalizedDirtyRects) {
          context.rect?.(
            dirtyRect.left,
            dirtyRect.top,
            dirtyRect.width,
            dirtyRect.height,
          );
        }
        context.clip?.();
      }

      entry.draw?.(context, {
        dirtyRect: viewportRect,
        entry,
        viewport: this.viewport,
        renderer: this,
      });

      if (hasDirtyRects) {
        context.restore?.();
      }
    }

    return normalizedDirtyRects.length > 0
      ? normalizedDirtyRects
      : [viewportRect];
  }
}

export { UiRenderer };
