/**
 * @file UI 覆盖层渲染器
 * @description 提供 Monitor.uiCanvas 的兼容渲染实现。
 * @module core/components/renderer/ui-renderer
 * @author Zhou Chenyu
 */

import { BasicObject } from "../../objects/basic-obj.js";
import { intersectsRanges, RectangleRange } from "../../range/index.js";
import { Monitor } from "../orchestration/monitor.js";
import { ActiveObjectManager } from "../orchestration/active-object-manager.js";
import { Logger } from "../../../utils/log/logger.js";
import { logBus } from "../../../utils/log/log-bus.js";
import {
  createRectangleDirtyRectMerger,
  RenderScheduler,
} from "./render-scheduler.js";
import { createLiveDirtyRectThresholdStrategy } from "./dirty-rect-strategy-shared.js";

const COMPAT_SELECTION_FRAME_MARGIN = 4;
const COMPAT_SELECTION_FRAME_STROKE_STYLE = "#33a1ff";
const COMPAT_SELECTION_FRAME_LINE_WIDTH = 1;
const COMPAT_SELECTION_FRAME_LINE_DASH = Object.freeze([]);
const COMPAT_SELECTION_GROUP_LINE_WIDTH = 1;
const COMPAT_SELECTION_GROUP_LINE_DASH = Object.freeze([10, 4]);

function expandRectForClear(rect) {
  const normalizedRect = RectangleRange.fromRectLike(rect);
  if (!normalizedRect) return undefined;

  const left = Math.floor(normalizedRect.left);
  const top = Math.floor(normalizedRect.top);
  const right = Math.ceil(normalizedRect.right);
  const bottom = Math.ceil(normalizedRect.bottom);

  return new RectangleRange(left, top, right - left, bottom - top);
}

function normalizeDirtyRectsForScreenUpdate(
  dirtyRects = [],
  fallbackRect = undefined,
) {
  const normalizedDirtyRects = dirtyRects
    .map((dirtyRect) => expandRectForClear(dirtyRect))
    .filter(Boolean);

  if (normalizedDirtyRects.length > 0) {
    return normalizedDirtyRects;
  }

  const normalizedFallbackRect = expandRectForClear(fallbackRect);
  return normalizedFallbackRect ? [normalizedFallbackRect] : [];
}

/**
 * UI 覆盖层渲染器
 * @description
 * 当前实现是 Core 侧的兼容层，负责绘制 chooser/modifier 的选择框等 UI 覆盖元素。
 * 自管理 uiCanvas、渲染调度器与脏区合并策略。
 * @class
 * @author Zhou Chenyu
 */
class UiRenderer {
  /**
   * 绑定的显示器
   * @type {Monitor}
   */
  monitor;

  /**
   * 活动对象管理器
   * @type {ActiveObjectManager | undefined}
   */
  activeObjectManager;

  /**
   * 自定义 overlay provider 集合
   * @type {Set<(context: { monitor: Monitor, activeObjectManager?: ActiveObjectManager, renderer: UiRenderer }) => any>}
   */
  overlayProviders;

  /**
   * 目标渲染层画布
   * @type {HTMLCanvasElement | null}
   * @private
   */
  _canvas;

  /**
   * 渲染调度器
   * @type {RenderScheduler | null}
   * @private
   */
  _scheduler;

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
   * @param {Monitor} monitor - 目标显示器
   * @param {ActiveObjectManager | undefined} activeObjectManager - 活动对象管理器
   * @param {{ canvas?: HTMLCanvasElement | null }} [options = {}] - 初始化选项
   */
  constructor(monitor, activeObjectManager, options = {}) {
    this.monitor = monitor;
    this.activeObjectManager = activeObjectManager;
    this.overlayProviders = new Set();
    this._canvas = options.canvas ?? null;
    this._resolveThresholds = createLiveDirtyRectThresholdStrategy();
    this._scheduler = new RenderScheduler({
      mergeDirtyRects: createRectangleDirtyRectMerger({
        getThresholds: () => this._resolveThresholds(monitor?.zoom ?? 1) ?? {},
        getViewportRect: () => monitor?.getViewportScreenRect?.(),
      }),
      flushHandler: (dirtyRects) => this.flush(dirtyRects),
    });

    /** @type {Logger} */
    this.#log = new Logger("UiRenderer", "WARN", logBus);
  }

  /**
   * 目标渲染层画布
   * @type {HTMLCanvasElement | null}
   */
  get canvas() {
    return this._canvas;
  }

  /**
   * 更新活动对象管理器引用
   * @param {ActiveObjectManager | undefined} activeObjectManager - 活动对象管理器
   */
  setActiveObjectManager(activeObjectManager) {
    this.activeObjectManager = activeObjectManager;
  }

  /**
   * 提交一次失效请求
   * @param {any} [rect] - 失效脏区
   * @returns {boolean}
   */
  invalidate(rect) {
    if (!this._scheduler) return false;
    return this._scheduler.invalidate(rect);
  }

  /**
   * 失效整个视口
   */
  invalidateViewport() {
    const viewportRect = this.monitor?.getViewportScreenRect?.();
    if (viewportRect?.width > 0 && viewportRect?.height > 0) {
      this.invalidate(viewportRect);
    }
  }

  /**
   * 调整画布尺寸
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   * @returns {boolean} 是否发生了尺寸变化
   */
  resize(width, height) {
    const canvas = this._canvas;
    if (!canvas) return false;
    const nextWidth = Number.isFinite(width) ? width : 0;
    const nextHeight = Number.isFinite(height) ? height : 0;
    if (canvas.width === nextWidth && canvas.height === nextHeight)
      return false;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    return true;
  }

  /**
   * 注册自定义 overlay provider
   * @param {(context: { monitor: Monitor, activeObjectManager?: ActiveObjectManager, renderer: UiRenderer }) => any} provider - provider
   * @returns {Function | undefined}
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
   * @param {Function} provider - provider
   * @returns {boolean}
   */
  unregisterOverlayProvider(provider) {
    return this.overlayProviders.delete(provider);
  }

  /**
   * 获取对象世界矩形范围
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectWorldRect(objectInstance) {
    try {
      const worldRange =
        this.activeObjectManager?.getObjectWorldRange?.(objectInstance) ??
        objectInstance?.getRange?.()?.withPosition?.(objectInstance.position);
      if (!worldRange) return undefined;
      return RectangleRange.from(worldRange);
    } catch {
      return undefined;
    }
  }

  /**
   * 获取兼容选中框的屏幕留白
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {number}
   */
  getCompatSelectionPadding(objectInstance) {
    const renderPadding = objectInstance?.getRenderPadding?.() ?? 0;
    const screenPadding =
      Number.isFinite(renderPadding) && renderPadding > 0
        ? renderPadding * (this.monitor?.zoom ?? 1)
        : 0;

    return Math.max(COMPAT_SELECTION_FRAME_MARGIN, Math.ceil(screenPadding));
  }

  /**
   * 从 summary-like 条目推导兼容选中框留白
   * @param {Object} summaryEntry - 摘要或兼容条目
   * @returns {number}
   */
  getCompatSelectionPaddingForSummary(summaryEntry) {
    const strokeWidthCandidates = [
      summaryEntry?.property?.strokeWidth,
      summaryEntry?.property?.width,
      summaryEntry?.property?.outlineWidth,
    ].filter((value) => Number.isFinite(value) && value > 0);

    const renderPadding =
      strokeWidthCandidates.length > 0
        ? Math.max(...strokeWidthCandidates) / 2
        : 0;
    const screenPadding =
      Number.isFinite(renderPadding) && renderPadding > 0
        ? renderPadding * (this.monitor?.zoom ?? 1)
        : 0;

    return Math.max(COMPAT_SELECTION_FRAME_MARGIN, Math.ceil(screenPadding));
  }

  /**
   * 解析 summary-like 条目的世界矩形范围
   * @param {Object} summaryEntry - 摘要或兼容条目
   * @returns {RectangleRange | undefined}
   */
  getSummaryWorldRect(summaryEntry) {
    if (!summaryEntry || typeof summaryEntry !== "object") {
      return undefined;
    }

    if (summaryEntry.worldRect) {
      return RectangleRange.fromRectLike(summaryEntry.worldRect);
    }

    const position = summaryEntry.position;
    if (
      !position ||
      typeof position.x !== "number" ||
      typeof position.y !== "number"
    ) {
      return undefined;
    }

    const localRange = summaryEntry.range;
    if (localRange && typeof localRange.withPosition === "function") {
      return RectangleRange.from(localRange.withPosition(position));
    }

    const localBoundingBoxSource =
      summaryEntry.boundingBox ?? summaryEntry.rich?.boundingBox;
    const localBoundingBox = localBoundingBoxSource
      ? RectangleRange.fromRectLike(localBoundingBoxSource)
      : undefined;
    if (
      localBoundingBox &&
      typeof localBoundingBox.withPosition === "function"
    ) {
      return RectangleRange.from(localBoundingBox.withPosition(position));
    }

    return undefined;
  }

  /**
   * 获取 summary-like 条目的兼容选中框屏幕矩形
   * @param {Object} summaryEntry - 摘要或兼容条目
   * @returns {RectangleRange | undefined}
   */
  getSummaryScreenRect(summaryEntry) {
    const worldRect = this.getSummaryWorldRect(summaryEntry);
    if (!worldRect) return undefined;

    return this.monitor?.worldRectToScreenRect?.(
      worldRect,
      this.getCompatSelectionPaddingForSummary(summaryEntry),
    );
  }

  /**
   * 获取对象兼容选中框的屏幕矩形
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectScreenRect(objectInstance) {
    const worldRect = this.getObjectWorldRect(objectInstance);
    if (!worldRect) return undefined;

    return this.monitor?.worldRectToScreenRect?.(
      worldRect,
      this.getCompatSelectionPadding(objectInstance),
    );
  }

  /**
   * 生成对象级兼容选中框 overlay 条目
   * @param {BasicObject} objectInstance - 对象实例
   * @param {string} source - 条目来源
   * @returns {{ source: string, objectId: number, type: string, screenRect: RectangleRange, draw: Function } | undefined}
   */
  createCompatObjectSelectionEntry(objectInstance, source) {
    const screenRect = this.getObjectScreenRect(objectInstance);
    if (!screenRect) return undefined;

    return {
      source,
      objectId: objectInstance.id,
      type: "rect",
      screenRect,
      strokeStyle: COMPAT_SELECTION_FRAME_STROKE_STYLE,
      lineWidth: COMPAT_SELECTION_FRAME_LINE_WIDTH,
      lineDash: [...COMPAT_SELECTION_FRAME_LINE_DASH],
      draw: (context) => {
        this.drawRectEntry(context, {
          screenRect,
          strokeStyle: COMPAT_SELECTION_FRAME_STROKE_STYLE,
          lineWidth: COMPAT_SELECTION_FRAME_LINE_WIDTH,
          lineDash: [...COMPAT_SELECTION_FRAME_LINE_DASH],
        });
      },
    };
  }

  /**
   * 生成 summary-like 条目级兼容选中框 overlay 条目
   * @param {Object} summaryEntry - 摘要或兼容条目
   * @param {string} source - 条目来源
   * @returns {{ source: string, objectId: number|undefined, type: string, screenRect: RectangleRange, draw: Function } | undefined}
   */
  createCompatSummarySelectionEntry(summaryEntry, source) {
    const screenRect = this.getSummaryScreenRect(summaryEntry);
    if (!screenRect) return undefined;

    return {
      source,
      objectId: summaryEntry?.id,
      type: "rect",
      screenRect,
      strokeStyle: COMPAT_SELECTION_FRAME_STROKE_STYLE,
      lineWidth: COMPAT_SELECTION_FRAME_LINE_WIDTH,
      lineDash: [...COMPAT_SELECTION_FRAME_LINE_DASH],
      draw: (context) => {
        this.drawRectEntry(context, {
          screenRect,
          strokeStyle: COMPAT_SELECTION_FRAME_STROKE_STYLE,
          lineWidth: COMPAT_SELECTION_FRAME_LINE_WIDTH,
          lineDash: [...COMPAT_SELECTION_FRAME_LINE_DASH],
        });
      },
    };
  }

  /**
   * 生成组合大矩形 overlay 条目
   * @param {RectangleRange} screenRect - 组合屏幕矩形
   * @param {string} source - 条目来源
   * @returns {{ source: string, type: string, screenRect: RectangleRange, draw: Function }}
   */
  createCompatGroupSelectionEntry(screenRect, source) {
    return {
      source,
      type: "rect",
      screenRect,
      strokeStyle: COMPAT_SELECTION_FRAME_STROKE_STYLE,
      lineWidth: COMPAT_SELECTION_GROUP_LINE_WIDTH,
      lineDash: [...COMPAT_SELECTION_GROUP_LINE_DASH],
      draw: (context) => {
        this.drawRectEntry(context, {
          screenRect,
          strokeStyle: COMPAT_SELECTION_FRAME_STROKE_STYLE,
          lineWidth: COMPAT_SELECTION_GROUP_LINE_WIDTH,
          lineDash: [...COMPAT_SELECTION_GROUP_LINE_DASH],
        });
      },
    };
  }

  /**
   * 基于对象集合生成兼容选择框条目
   * @param {BasicObject[]} objects - 对象集合
   * @param {string} role - 当前角色
   * @returns {Array<Object>}
   */
  createCompatSelectionEntriesForObjects(objects, role) {
    const objectEntries = objects
      .map((objectInstance) =>
        this.createCompatObjectSelectionEntry(
          objectInstance,
          `compat-selection-object-frame:${role}`,
        ),
      )
      .filter(Boolean);

    if (objectEntries.length <= 1) {
      return objectEntries;
    }

    const groupScreenRect = objectEntries.reduce((combinedRect, entry) => {
      const screenRect = RectangleRange.fromRectLike(entry.screenRect);
      if (!screenRect) {
        return combinedRect;
      }
      return combinedRect ? combinedRect.union(screenRect) : screenRect;
    }, undefined);

    if (!groupScreenRect) {
      return objectEntries;
    }

    return [
      ...objectEntries,
      this.createCompatGroupSelectionEntry(
        groupScreenRect,
        `compat-selection-group-frame:${role}`,
      ),
    ];
  }

  /**
   * 基于 summary-like 条目生成兼容选择框条目
   * @param {Object[]} summaries - 摘要或兼容条目集合
   * @param {string} role - 当前角色
   * @returns {Array<Object>}
   */
  createCompatSelectionEntriesForSummaries(summaries, role) {
    const objectEntries = summaries
      .map((summaryEntry) =>
        this.createCompatSummarySelectionEntry(
          summaryEntry,
          `compat-selection-object-frame:${role}`,
        ),
      )
      .filter(Boolean);

    if (objectEntries.length <= 1) {
      return objectEntries;
    }

    const groupScreenRect = objectEntries.reduce((combinedRect, entry) => {
      const screenRect = RectangleRange.fromRectLike(entry.screenRect);
      if (!screenRect) {
        return combinedRect;
      }
      return combinedRect ? combinedRect.union(screenRect) : screenRect;
    }, undefined);

    if (!groupScreenRect) {
      return objectEntries;
    }

    return [
      ...objectEntries,
      this.createCompatGroupSelectionEntry(
        groupScreenRect,
        `compat-selection-group-frame:${role}`,
      ),
    ];
  }

  /**
   * 规范化单个 overlay 条目
   * @param {Object} entry - 原始条目
   * @returns {Object | undefined}
   */
  normalizeOverlayEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return undefined;
    }

    const normalizedEntry = { ...entry };
    const objectInstance =
      normalizedEntry.object instanceof BasicObject
        ? normalizedEntry.object
        : undefined;

    if (!normalizedEntry.screenRect) {
      if (normalizedEntry.worldRect) {
        const worldRect = RectangleRange.fromRectLike(normalizedEntry.worldRect);
        if (worldRect) {
          normalizedEntry.screenRect = this.monitor?.worldRectToScreenRect?.(
            worldRect,
            normalizedEntry.padding ?? 0,
          );
        }
      } else if (objectInstance) {
        normalizedEntry.screenRect = this.getObjectScreenRect(objectInstance);
      } else {
        const worldRect = this.getSummaryWorldRect(normalizedEntry);
        if (worldRect) {
          normalizedEntry.screenRect = this.monitor?.worldRectToScreenRect?.(
            worldRect,
            normalizedEntry.padding ??
              this.getCompatSelectionPaddingForSummary(normalizedEntry),
          );
        }
      }
    }

    if (normalizedEntry.screenRect) {
      normalizedEntry.screenRect = RectangleRange.fromRectLike(
        normalizedEntry.screenRect,
      );
    }

    if (typeof normalizedEntry.draw !== "function") {
      if (normalizedEntry.type === "rect" && normalizedEntry.screenRect) {
        normalizedEntry.draw = (context) => {
          this.drawRectEntry(context, normalizedEntry);
        };
      }
    }

    return typeof normalizedEntry.draw === "function"
      ? normalizedEntry
      : undefined;
  }

  /**
   * 收集自定义 overlay 条目
   * @returns {Array<Object>}
   */
  collectProviderOverlayEntries() {
    const overlayEntries = [];

    for (const provider of this.overlayProviders) {
      try {
        const result = provider({
          monitor: this.monitor,
          activeObjectManager: this.activeObjectManager,
          renderer: this,
        });
        const entries = Array.isArray(result) ? result : [result];

        for (const entry of entries) {
          const normalizedEntry = this.normalizeOverlayEntry(entry);
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
   * @returns {Array<Object>}
   */
  collectOverlayEntries() {
    return this.collectProviderOverlayEntries();
  }

  /**
   * 绘制矩形 overlay 条目
   * @param {CanvasRenderingContext2D} context - 画布上下文
   * @param {{ screenRect?: RectangleRange, fillStyle?: string, strokeStyle?: string, lineWidth?: number, lineDash?: number[] }} entry - 条目
   */
  drawRectEntry(context, entry = {}) {
    const screenRect = RectangleRange.fromRectLike(entry.screenRect);
    if (!screenRect) return;

    context.save?.();
    if (typeof context.setLineDash === "function") {
      context.setLineDash(entry.lineDash ?? []);
    }
    if (entry.fillStyle !== undefined) {
      context.fillStyle = entry.fillStyle;
      context.fillRect?.(
        screenRect.left,
        screenRect.top,
        screenRect.width,
        screenRect.height,
      );
    }
    if (entry.strokeStyle !== undefined) {
      context.strokeStyle = entry.strokeStyle;
    }
    if (Number.isFinite(entry.lineWidth)) {
      context.lineWidth = entry.lineWidth;
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
   * 执行 UI 覆盖层刷新
   * @param {Array<RectangleRange | Object>} [dirtyRects=[]] - 脏区集合
   * @returns {RectangleRange[]} 本次实际处理的脏区
   */
  flush(dirtyRects = []) {
    const context = this._canvas?.getContext?.("2d") ?? null;
    if (!context) return [];

    const normalizedDirtyRects = normalizeDirtyRectsForScreenUpdate(
      dirtyRects,
      this.monitor?.getViewportScreenRect?.(),
    );
    if (normalizedDirtyRects.length === 0) {
      return [];
    }

    for (const dirtyRect of normalizedDirtyRects) {
      context.clearRect?.(
        dirtyRect.left,
        dirtyRect.top,
        dirtyRect.width,
        dirtyRect.height,
      );
    }

    const overlayEntries = this.collectOverlayEntries();
    if (overlayEntries.length === 0) {
      return normalizedDirtyRects;
    }

    for (const dirtyRect of normalizedDirtyRects) {
      const visibleEntries = overlayEntries.filter((entry) => {
        if (!entry?.screenRect) return true;
        return intersectsRanges(entry.screenRect, dirtyRect);
      });
      if (visibleEntries.length === 0) continue;

      context.save?.();
      context.beginPath?.();
      context.rect?.(
        dirtyRect.left,
        dirtyRect.top,
        dirtyRect.width,
        dirtyRect.height,
      );
      context.clip?.();

      for (const entry of visibleEntries) {
        entry.draw?.(context, {
          dirtyRect,
          entry,
          monitor: this.monitor,
          activeObjectManager: this.activeObjectManager,
          renderer: this,
        });
      }

      context.restore?.();
    }

    return normalizedDirtyRects;
  }
}

export { UiRenderer };
