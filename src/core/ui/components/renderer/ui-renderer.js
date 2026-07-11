/**
 * @file UI 覆盖层渲染器
 * @description 提供 Viewport.uiCanvas 的兼容渲染实现。
 * @module core/ui/components/renderer/ui-renderer
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../../../shared/range/index.js";
import { Viewport } from "../orchestration/viewport.js";
import { Logger } from "../../../../utils/log/logger.js";
import { logBus } from "../../../../utils/log/log-bus.js";
import { createRectangleDirtyRectMerger } from "../../../shared/renderer/render-scheduler.js";
import { createLiveDirtyRectThresholdStrategy } from "../../../shared/renderer/dirty-rect-strategy-shared.js";
import { CanvasHost } from "../../../shared/renderer/canvas-lifecycle.js";
import { normalizeOverlayEntry as normalizeOverlayEntryFactory } from "../../../shared/renderer/ui-overlay-factory.js";

/**
 * UI overlay provider
 * @callback UiOverlayProvider
 * @param {{ viewport: Viewport, renderer: UiRenderer }} context - provider 上下文
 * @returns {import("../../../shared/renderer/ui-overlay-factory.js").UiOverlayEntry | import("../../../shared/renderer/ui-overlay-factory.js").UiOverlayEntry[] | undefined}
 */

/**
 * UI 覆盖层渲染器
 * @description
 * 负责绘制 chooser/modifier 的选择框等 UI 覆盖元素。
 * 自管理 uiCanvas、渲染调度器与脏区合并策略。不参与 Worker 侧渲染。
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
   * @returns {import("../../../shared/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectProviderOverlayEntries() {
    const overlayEntries = [];

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
            (context, rectEntry) => this.drawRectEntry(context, rectEntry),
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
   * @returns {import("../../../shared/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectOverlayEntries() {
    return this.collectProviderOverlayEntries();
  }

  /**
   * 绘制矩形 overlay 条目
   * @param {CanvasRenderingContext2D} context - 画布上下文
   * @param {import("../../../shared/renderer/ui-overlay-factory.js").UiOverlayEntry} entry - 矩形条目
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
   * 执行 UI 覆盖层刷新（全量重绘）
   * @description
   * 临时跳过脏区优化，全量清空 uiCanvas 并重绘所有 overlay 条目。
   * @param {Array<RectangleRange | Object>} [dirtyRects=[]] - 脏区集合（当前忽略）
   * @returns {RectangleRange[]} 本次实际处理的脏区
   */
  flush(dirtyRects = []) {
    const context = this._getContext();
    if (!context) return [];

    const viewportRect = this.viewport?.getViewportScreenRect?.();
    if (!viewportRect || viewportRect.width <= 0 || viewportRect.height <= 0) {
      return [];
    }

    // 全量清空 uiCanvas
    context.clearRect?.(0, 0, viewportRect.width, viewportRect.height);

    const overlayEntries = this.collectOverlayEntries();
    if (overlayEntries.length === 0) {
      return [viewportRect];
    }

    // 全量绘制所有 overlay 条目
    for (const entry of overlayEntries) {
      entry.draw?.(context, {
        dirtyRect: viewportRect,
        entry,
        viewport: this.viewport,
        renderer: this,
      });
    }

    return [viewportRect];
  }


}

export { UiRenderer };
