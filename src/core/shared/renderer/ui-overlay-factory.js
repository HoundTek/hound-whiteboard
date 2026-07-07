/**
 * @file UI overlay 条目工厂
 * @description 提供 overlay 条目的创建、归一化与坐标辅助函数。
 * @module core/shared/renderer/ui-overlay-factory
 * @author Zhou Chenyu
 */

import { BasicObject } from "../objects/basic-obj.js";
import { RectangleRange } from "../range/index.js";

/**
 * 兼容选中框的最小留白（屏幕像素）
 * @type {number}
 */
const COMPAT_SELECTION_FRAME_MARGIN = 4;

/**
 * UI overlay 条目
 * @typedef {Object} UiOverlayEntry
 * @property {string} source - 条目来源标识（如 "compat-selection-object-frame:chooser"）
 * @property {number} [objectId] - 关联的白板对象 id
 * @property {string} type - 条目类型（当前仅 "rect"）
 * @property {RectangleRange} [screenRect] - 屏幕空间的矩形范围
 * @property {RectangleRange} [worldRect] - 世界空间的矩形范围（归一化前使用）
 * @property {string} [fillStyle] - 填充色
 * @property {string} [strokeStyle] - 描边色
 * @property {number} [lineWidth] - 描边线宽
 * @property {number[]} [lineDash] - 描边虚线模式
 * @property {number} [padding] - world→screen 转换时的额外留白
 * @property {BasicObject} [object] - BasicObject 实例（provider 直接传入时使用）
 * @property {{ x: number, y: number }} [position] - 条目所属对象的世界坐标
 * @property {Object} [range] - 条目所属对象的局部范围
 * @property {Object} [boundingBox] - 条目所属对象的包围盒
 * @property {Object} [property] - 条目所属对象的属性
 * @property {(context: CanvasRenderingContext2D, runtime: UiOverlayDrawRuntime) => void} draw - 绘制函数
 */

/**
 * UI overlay 绘制运行时上下文
 * @typedef {Object} UiOverlayDrawRuntime
 * @property {RectangleRange} dirtyRect - 当前裁剪脏区
 * @property {UiOverlayEntry} entry - 当前绘制的条目
 * @property {import("../../ui/components/orchestration/viewport.js").Viewport} viewport - 当前视口
 * @property {import("./ui-renderer.js").UiRenderer} renderer - 当前渲染器
 */

/**
 * Summary-like 条目
 * @typedef {Object} SummaryLikeEntry
 * @property {number} [id] - 对象 id
 * @property {{ x: number, y: number }} [position] - 对象世界坐标
 * @property {Object} [range] - 带 withPosition 方法的局部范围
 * @property {Object} [boundingBox] - 局部包围盒（left, top, width, height 或 left, top, right, bottom）
 * @property {Object} [worldRect] - 世界矩形（绕过 position+range 计算）
 * @property {Object} [rich] - 富数据，内含 boundingBox
 * @property {Object} [property] - 属性，可含 strokeWidth/width/outlineWidth
 */

/**
 * 获取对象世界矩形范围
 * @param {BasicObject} objectInstance - 对象实例
 * @returns {RectangleRange | undefined}
 */
function getObjectWorldRect(objectInstance) {
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
 * 获取对象兼容选中框的屏幕留白
 * @param {BasicObject} objectInstance - 对象实例
 * @param {number} zoom - 当前缩放比例
 * @returns {number}
 */
function getCompatSelectionPadding(objectInstance, zoom) {
  const renderPadding = objectInstance?.getRenderPadding?.() ?? 0;
  const screenPadding =
    Number.isFinite(renderPadding) && renderPadding > 0
      ? renderPadding * zoom
      : 0;

  return Math.max(COMPAT_SELECTION_FRAME_MARGIN, Math.ceil(screenPadding));
}

/**
 * 从 summary-like 条目推导兼容选中框留白
 * @param {SummaryLikeEntry} summaryEntry - 摘要或兼容条目
 * @param {number} zoom - 当前缩放比例
 * @returns {number}
 */
function getCompatSelectionPaddingForSummary(summaryEntry, zoom) {
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
      ? renderPadding * zoom
      : 0;

  return Math.max(COMPAT_SELECTION_FRAME_MARGIN, Math.ceil(screenPadding));
}

/**
 * 解析 summary-like 条目的世界矩形范围
 * @param {SummaryLikeEntry} summaryEntry - 摘要或兼容条目
 * @returns {RectangleRange | undefined}
 */
function getSummaryWorldRect(summaryEntry) {
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
  if (localBoundingBox && typeof localBoundingBox.withPosition === "function") {
    return RectangleRange.from(localBoundingBox.withPosition(position));
  }

  return undefined;
}

/**
 * 获取 summary-like 条目的兼容选中框屏幕矩形
 * @param {SummaryLikeEntry} summaryEntry - 摘要或兼容条目
 * @param {import("../../ui/components/orchestration/viewport.js").Viewport} viewport - 视口
 * @returns {RectangleRange | undefined}
 */
function getSummaryScreenRect(summaryEntry, viewport) {
  const worldRect = getSummaryWorldRect(summaryEntry);
  if (!worldRect) return undefined;

  return viewport?.worldRectToScreenRect?.(
    worldRect,
    getCompatSelectionPaddingForSummary(summaryEntry, viewport?.zoom ?? 1),
  );
}

/**
 * 获取对象兼容选中框的屏幕矩形
 * @param {BasicObject} objectInstance - 对象实例
 * @param {import("../../ui/components/orchestration/viewport.js").Viewport} viewport - 视口
 * @returns {RectangleRange | undefined}
 */
function getObjectScreenRect(objectInstance, viewport) {
  const worldRect = getObjectWorldRect(objectInstance);
  if (!worldRect) return undefined;

  return viewport?.worldRectToScreenRect?.(
    worldRect,
    getCompatSelectionPadding(objectInstance, viewport?.zoom ?? 1),
  );
}

/**
 * 生成 summary-like 条目级兼容选中框 overlay 条目
 * @param {SummaryLikeEntry} summaryEntry - 摘要或兼容条目
 * @param {string} source - 条目来源
 * @param {import("../../ui/components/orchestration/viewport.js").Viewport} viewport - 视口
 * @param {(context: CanvasRenderingContext2D, entry: UiOverlayEntry) => void} drawRectEntry - 矩形绘制函数
 * @returns {UiOverlayEntry | undefined}
 */
function createCompatSummarySelectionEntry(
  summaryEntry,
  source,
  viewport,
  drawRectEntry,
) {
  const screenRect = getSummaryScreenRect(summaryEntry, viewport);
  if (!screenRect) return undefined;

  return {
    source,
    objectId: summaryEntry?.id,
    type: "rect",
    screenRect,
    strokeStyle: "#33a1ff",
    lineWidth: 1,
    lineDash: [],
    draw: (context) => {
      drawRectEntry(context, {
        screenRect,
        strokeStyle: "#33a1ff",
        lineWidth: 1,
        lineDash: [],
      });
    },
  };
}

/**
 * 生成组合大矩形 overlay 条目
 * @param {RectangleRange} screenRect - 组合屏幕矩形
 * @param {string} source - 条目来源
 * @param {(context: CanvasRenderingContext2D, entry: UiOverlayEntry) => void} drawRectEntry - 矩形绘制函数
 * @returns {UiOverlayEntry}
 */
function createCompatGroupSelectionEntry(screenRect, source, drawRectEntry) {
  return {
    source,
    type: "rect",
    screenRect,
    strokeStyle: "#33a1ff",
    lineWidth: 1,
    lineDash: [10, 4],
    draw: (context) => {
      drawRectEntry(context, {
        screenRect,
        strokeStyle: "#33a1ff",
        lineWidth: 1,
        lineDash: [10, 4],
      });
    },
  };
}

/**
 * 基于 summary-like 条目生成兼容选择框条目
 * @param {SummaryLikeEntry[]} summaries - 摘要或兼容条目集合
 * @param {string} role - 当前角色（如 "chooser"、"modifier"）
 * @param {import("../../ui/components/orchestration/viewport.js").Viewport} viewport - 视口
 * @param {(context: CanvasRenderingContext2D, entry: UiOverlayEntry) => void} drawRectEntry - 矩形绘制函数
 * @returns {UiOverlayEntry[]}
 */
function createCompatSelectionEntriesForSummaries(
  summaries,
  role,
  viewport,
  drawRectEntry,
) {
  const objectEntries = summaries
    .map((summaryEntry) =>
      createCompatSummarySelectionEntry(
        summaryEntry,
        `compat-selection-object-frame:${role}`,
        viewport,
        drawRectEntry,
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
    createCompatGroupSelectionEntry(
      groupScreenRect,
      `compat-selection-group-frame:${role}`,
      drawRectEntry,
    ),
  ];
}

/**
 * 规范化单个 overlay 条目
 * @description 补全 screenRect、为 rect 类型条目注入默认 draw 函数。
 * @param {Object} entry - 原始条目（provider 返回的未归一化条目）
 * @param {import("../../ui/components/orchestration/viewport.js").Viewport} viewport - 视口
 * @param {(context: CanvasRenderingContext2D, entry: UiOverlayEntry) => void} drawRectEntry - 矩形绘制函数
 * @returns {UiOverlayEntry | undefined}
 */
function normalizeOverlayEntry(entry, viewport, drawRectEntry) {
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
        normalizedEntry.screenRect = viewport?.worldRectToScreenRect?.(
          worldRect,
          normalizedEntry.padding ?? 0,
        );
      }
    } else if (objectInstance) {
      normalizedEntry.screenRect = getObjectScreenRect(
        objectInstance,
        viewport,
      );
    } else {
      const worldRect = getSummaryWorldRect(normalizedEntry);
      if (worldRect) {
        normalizedEntry.screenRect = viewport?.worldRectToScreenRect?.(
          worldRect,
          normalizedEntry.padding ??
            getCompatSelectionPaddingForSummary(
              normalizedEntry,
              viewport?.zoom ?? 1,
            ),
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
        drawRectEntry(context, normalizedEntry);
      };
    }
  }

  return typeof normalizedEntry.draw === "function"
    ? normalizedEntry
    : undefined;
}

export {
  getObjectWorldRect,
  getCompatSelectionPadding,
  getCompatSelectionPaddingForSummary,
  getSummaryWorldRect,
  getSummaryScreenRect,
  getObjectScreenRect,
  createCompatSelectionEntriesForSummaries,
  normalizeOverlayEntry,
};
