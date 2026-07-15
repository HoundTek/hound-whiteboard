/**
 * @file UI overlay 条目工厂
 * @description 提供 overlay 条目的创建、归一化与坐标辅助函数。
 * @module core/ui-thread/components/renderer/ui-overlay-factory
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../../../engine/range/index.js";

/**
 * 兼容选中框的最小留白（屏幕像素）
 * @type {number}
 */
const COMPAT_SELECTION_FRAME_MARGIN = 4;

/**
 * UI overlay 画法属性
 * @typedef {Object} UiOverlayStyle
 * @property {string} [fillStyle] - 填充色
 * @property {string} [strokeStyle] - 描边色
 * @property {number} [lineWidth] - 描边线宽
 * @property {number[]} [lineDash] - 描边虚线模式
 */

/**
 * UI overlay 条目
 * @typedef {Object} UiOverlayEntry
 * @property {string} source - 条目来源标识（如 "compat-selection-object-frame:chooser"）
 * @property {number} [objectId] - 关联的白板对象 id
 * @property {"rect"|"point"|"path"} type - 条目类型
 * @property {Record<string, any>} geometry - 类型专属几何，字段按 type 约定
 * @property {UiOverlayStyle} [style] - 画法属性
 * @property {(context: CanvasRenderingContext2D, runtime: UiOverlayDrawRuntime) => void} [draw] - 绘制函数，归一化阶段注入
 */

/**
 * UI overlay 绘制运行时上下文
 * @typedef {Object} UiOverlayDrawRuntime
 * @property {RectangleRange} dirtyRect - 当前裁剪脏区
 * @property {UiOverlayEntry} entry - 当前绘制的条目
 * @property {import("../orchestration/viewport.js").Viewport} viewport - 当前视口
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
 * @param {import("../orchestration/viewport.js").Viewport} viewport - 视口
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
 * @param {import("../orchestration/viewport.js").Viewport} viewport - 视口
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
 * @param {import("../orchestration/viewport.js").Viewport} viewport - 视口
 * @returns {UiOverlayEntry | undefined}
 */
function createCompatSummarySelectionEntry(summaryEntry, source, viewport) {
  const screenRect = getSummaryScreenRect(summaryEntry, viewport);
  if (!screenRect) return undefined;

  return {
    source,
    objectId: summaryEntry?.id,
    type: "rect",
    geometry: {
      screenRect,
    },
    style: {
      strokeStyle: "#33a1ff",
      lineWidth: 1,
      lineDash: [],
    },
  };
}

/**
 * 生成组合大矩形 overlay 条目
 * @param {RectangleRange} screenRect - 组合屏幕矩形
 * @param {string} source - 条目来源
 * @returns {UiOverlayEntry}
 */
function createCompatGroupSelectionEntry(screenRect, source) {
  return {
    source,
    type: "rect",
    geometry: {
      screenRect,
    },
    style: {
      strokeStyle: "#33a1ff",
      lineWidth: 1,
      lineDash: [10, 4],
    },
  };
}

/**
 * 基于 summary-like 条目生成兼容选择框条目
 * @param {SummaryLikeEntry[]} summaries - 摘要或兼容条目集合
 * @param {string} role - 当前角色（如 "chooser"、"modifier"）
 * @param {import("../orchestration/viewport.js").Viewport} viewport - 视口
 * @returns {UiOverlayEntry[]}
 */
function createCompatSelectionEntriesForSummaries(summaries, role, viewport) {
  const objectEntries = summaries
    .map((summaryEntry) =>
      createCompatSummarySelectionEntry(
        summaryEntry,
        `compat-selection-object-frame:${role}`,
        viewport,
      ),
    )
    .filter(Boolean);

  if (objectEntries.length <= 1) {
    return objectEntries;
  }

  const groupScreenRect = objectEntries.reduce((combinedRect, entry) => {
    const screenRect = RectangleRange.fromRectLike(entry.geometry.screenRect);
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
    ),
  ];
}

/**
 * 将世界坐标点转为屏幕坐标点
 * @param {{ x: number, y: number }} worldPoint - 世界坐标
 * @param {import("../orchestration/viewport.js").Viewport} viewport - 视口
 * @returns {{ x: number, y: number } | undefined}
 */
function worldToScreenPoint(worldPoint, viewport) {
  if (
    !worldPoint ||
    typeof worldPoint.x !== "number" ||
    typeof worldPoint.y !== "number" ||
    !viewport
  ) {
    return undefined;
  }
  const { origin, zoom } = viewport;
  if (
    typeof origin?.x !== "number" ||
    typeof origin?.y !== "number" ||
    typeof zoom !== "number"
  ) {
    return undefined;
  }
  return {
    x: (worldPoint.x - origin.x) * zoom,
    y: (worldPoint.y - origin.y) * zoom,
  };
}

/**
 * 批量将世界坐标点数组转为屏幕坐标点数组
 * @param {Array<{x: number, y: number}>} worldPoints - 世界坐标点数组
 * @param {import("../orchestration/viewport.js").Viewport} viewport - 视口
 * @returns {Array<{x: number, y: number}> | undefined}
 */
function worldPointsToScreenPoints(worldPoints, viewport) {
  if (!Array.isArray(worldPoints) || worldPoints.length === 0) {
    return undefined;
  }

  const screenPoints = [];
  for (const wp of worldPoints) {
    const sp = worldToScreenPoint(wp, viewport);
    if (sp) {
      screenPoints.push(sp);
    }
  }

  return screenPoints.length > 0 ? screenPoints : undefined;
}

/**
 * 创建点类型 overlay 条目
 * @param {{ x: number, y: number }} worldPoint - 世界坐标
 * @param {{ fillStyle?: string, strokeStyle?: string, radius?: number, source?: string }} [options] - 选项
 * @param {import("../orchestration/viewport.js").Viewport} viewport - 视口
 * @returns {UiOverlayEntry | undefined}
 */
function createPointOverlayEntry(worldPoint, options = {}, viewport) {
  if (!worldPoint || !viewport) return undefined;

  return {
    source: options.source ?? "point",
    type: "point",
    geometry: {
      worldPoint,
      radius: options.radius ?? 4,
    },
    style: {
      fillStyle: options.fillStyle ?? "#33a1ff",
      strokeStyle: options.strokeStyle,
    },
  };
}

/**
 * 创建路径类型 overlay 条目
 * @param {Array<{x: number, y: number}>} worldPoints - 世界坐标点数组
 * @param {{ strokeStyle?: string, fillStyle?: string, lineWidth?: number, lineDash?: number[], closePath?: boolean, source?: string }} [options] - 选项
 * @param {import("../orchestration/viewport.js").Viewport} viewport - 视口
 * @returns {UiOverlayEntry | undefined}
 */
function createPathOverlayEntry(worldPoints, options = {}, viewport) {
  if (!Array.isArray(worldPoints) || worldPoints.length < 2 || !viewport) {
    return undefined;
  }

  return {
    source: options.source ?? "path",
    type: "path",
    geometry: {
      worldPoints,
      closePath: options.closePath ?? false,
    },
    style: {
      strokeStyle: options.strokeStyle ?? "#33a1ff",
      fillStyle: options.fillStyle,
      lineWidth: options.lineWidth ?? 1,
      lineDash: options.lineDash ?? [],
    },
  };
}

/**
 * 规范化单个 overlay 条目
 * @description
 * 将 entry.geometry 中的 world 坐标转为 screen 坐标并清理 world 字段。
 * 为 rect/point/path 类型注入默认 draw 函数（provider 未提供时）。
 * 无 geometry 的条目直接丢弃。
 * @param {Object} entry - 原始条目（必须含 geometry）
 * @param {import("../orchestration/viewport.js").Viewport} viewport - 视口
 * @param {{
 *   drawRectEntry: (context: CanvasRenderingContext2D, entry: UiOverlayEntry) => void,
 *   drawPointEntry: (context: CanvasRenderingContext2D, entry: UiOverlayEntry) => void,
 *   drawPathEntry: (context: CanvasRenderingContext2D, entry: UiOverlayEntry) => void,
 * }} drawFns - 各类型的绘制函数
 * @returns {UiOverlayEntry | undefined}
 */
function normalizeOverlayEntry(entry, viewport, drawFns) {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }

  const g = entry.geometry;
  if (typeof g !== "object") {
    return undefined;
  }

  const norm = { ...entry, geometry: { ...g } };
  const ng = norm.geometry;

  // rect: worldRect → screenRect
  if (norm.type === "rect") {
    if (ng.worldRect && !ng.screenRect) {
      const wr = RectangleRange.fromRectLike(ng.worldRect);
      if (wr) {
        ng.screenRect = viewport?.worldRectToScreenRect?.(wr, 0);
      }
    }
    if (ng.screenRect) {
      ng.screenRect = RectangleRange.fromRectLike(ng.screenRect);
    }
    delete ng.worldRect;
  }

  // point: worldPoint → screenPoint
  if (norm.type === "point") {
    if (ng.worldPoint && !ng.screenPoint) {
      ng.screenPoint = worldToScreenPoint(ng.worldPoint, viewport);
    }
    delete ng.worldPoint;
  }

  // path: worldPoints → screenPoints
  if (norm.type === "path") {
    if (ng.worldPoints && !ng.screenPoints) {
      ng.screenPoints = worldPointsToScreenPoints(ng.worldPoints, viewport);
    }
    delete ng.worldPoints;
  }

  // 注入默认 draw
  if (typeof norm.draw !== "function") {
    if (norm.type === "rect" && ng.screenRect && drawFns?.drawRectEntry) {
      norm.draw = (ctx) => drawFns.drawRectEntry(ctx, norm);
    } else if (
      norm.type === "point" &&
      ng.screenPoint &&
      drawFns?.drawPointEntry
    ) {
      norm.draw = (ctx) => drawFns.drawPointEntry(ctx, norm);
    } else if (
      norm.type === "path" &&
      ng.screenPoints?.length >= 2 &&
      drawFns?.drawPathEntry
    ) {
      norm.draw = (ctx) => drawFns.drawPathEntry(ctx, norm);
    }
  }

  return typeof norm.draw === "function" ? norm : undefined;
}

export {
  getObjectWorldRect,
  getCompatSelectionPadding,
  getCompatSelectionPaddingForSummary,
  getSummaryWorldRect,
  getSummaryScreenRect,
  getObjectScreenRect,
  createCompatSelectionEntriesForSummaries,
  worldToScreenPoint,
  worldPointsToScreenPoints,
  createPointOverlayEntry,
  createPathOverlayEntry,
  normalizeOverlayEntry,
};
