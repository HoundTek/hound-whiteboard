/**
 * @file 渲染调度器
 * @description 负责脏区域合并、清理和渲染顺序的调度策略。
 * @module core/components/render-scheduler
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../range/rectangle.js";
import { intersectsRanges } from "../range/geometry.js";

const DIRTY_RECT_NEAR_GAP = 8;
const DIRTY_RECT_DIAGONAL_GAP = 4;
const DIRTY_RECT_MAX_EXTRA_AREA = 256;
const DIRTY_RECT_MAX_GROWTH_RATIO = 1.35;
const DIRTY_RECT_VIEWPORT_COVERAGE_RATIO = 0.75;
const DIRTY_RECT_CANONICAL_RECT_COVERAGE_RATIO = 0.6;

function getRectangleArea(rect) {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function getRectangleIntersectionArea(firstRect, secondRect) {
  const left = Math.max(firstRect.left, secondRect.left);
  const top = Math.max(firstRect.top, secondRect.top);
  const right = Math.min(firstRect.right, secondRect.right);
  const bottom = Math.min(firstRect.bottom, secondRect.bottom);

  if (right <= left || bottom <= top) {
    return 0;
  }

  return (right - left) * (bottom - top);
}

function getRectangleGap(firstRect, secondRect) {
  const gapX = Math.max(
    0,
    Math.max(firstRect.left, secondRect.left) -
      Math.min(firstRect.right, secondRect.right),
  );
  const gapY = Math.max(
    0,
    Math.max(firstRect.top, secondRect.top) -
      Math.min(firstRect.bottom, secondRect.bottom),
  );

  return { gapX, gapY };
}

function shouldMergeNearbyRects(firstRect, secondRect) {
  if (intersectsRanges(firstRect, secondRect)) {
    return true;
  }

  const { gapX, gapY } = getRectangleGap(firstRect, secondRect);
  const isAxisNearby =
    (gapX <= DIRTY_RECT_NEAR_GAP && gapY === 0) ||
    (gapY <= DIRTY_RECT_NEAR_GAP && gapX === 0);
  const isDiagonalNearby =
    gapX <= DIRTY_RECT_DIAGONAL_GAP && gapY <= DIRTY_RECT_DIAGONAL_GAP;

  if (!isAxisNearby && !isDiagonalNearby) {
    return false;
  }

  const unionRect = firstRect.union(secondRect);
  const unionArea = getRectangleArea(unionRect);
  const combinedArea =
    getRectangleArea(firstRect) + getRectangleArea(secondRect);
  const extraArea = unionArea - combinedArea;

  if (extraArea <= DIRTY_RECT_MAX_EXTRA_AREA) {
    return true;
  }

  if (combinedArea <= 0) {
    return true;
  }

  return unionArea / combinedArea <= DIRTY_RECT_MAX_GROWTH_RATIO;
}

function normalizeRectangleArray(rects = []) {
  return rects.map((rect) => RectangleRange.fromRectLike(rect)).filter(Boolean);
}

function resolveOptionValue(optionValue, fallbackValue) {
  const resolvedValue =
    typeof optionValue === "function" ? optionValue() : optionValue;

  return resolvedValue ?? fallbackValue;
}

function resolveMergerThresholds(options = {}) {
  const groupedThresholds = resolveOptionValue(options.getThresholds, {}) ?? {};

  return {
    axisNearGap: resolveOptionValue(
      options.axisNearGap,
      resolveOptionValue(groupedThresholds.axisNearGap, DIRTY_RECT_NEAR_GAP),
    ),
    diagonalNearGap: resolveOptionValue(
      options.diagonalNearGap,
      resolveOptionValue(
        groupedThresholds.diagonalNearGap,
        DIRTY_RECT_DIAGONAL_GAP,
      ),
    ),
    maxExtraArea: resolveOptionValue(
      options.maxExtraArea,
      resolveOptionValue(
        groupedThresholds.maxExtraArea,
        DIRTY_RECT_MAX_EXTRA_AREA,
      ),
    ),
    maxGrowthRatio: resolveOptionValue(
      options.maxGrowthRatio,
      resolveOptionValue(
        groupedThresholds.maxGrowthRatio,
        DIRTY_RECT_MAX_GROWTH_RATIO,
      ),
    ),
    viewportCoverageRatio: resolveOptionValue(
      options.viewportCoverageRatio,
      resolveOptionValue(
        groupedThresholds.viewportCoverageRatio,
        DIRTY_RECT_VIEWPORT_COVERAGE_RATIO,
      ),
    ),
    canonicalRectCoverageRatio: resolveOptionValue(
      options.canonicalRectCoverageRatio,
      resolveOptionValue(
        groupedThresholds.canonicalRectCoverageRatio,
        DIRTY_RECT_CANONICAL_RECT_COVERAGE_RATIO,
      ),
    ),
  };
}

function dedupeRectangles(rects = []) {
  const uniqueRects = [];
  const rectKeys = new Set();

  for (const rect of rects) {
    const rectKey = `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
    if (rectKeys.has(rectKey)) continue;
    rectKeys.add(rectKey);
    uniqueRects.push(rect);
  }

  return uniqueRects;
}

function createRectangleDirtyRectMerger(options = {}) {
  const getViewportRect = options.getViewportRect;
  const getCanonicalRectsForRect = options.getCanonicalRectsForRect;

  function shouldMergeWithOptions(firstRect, secondRect, thresholds) {
    const { axisNearGap, diagonalNearGap, maxExtraArea, maxGrowthRatio } =
      thresholds;

    if (intersectsRanges(firstRect, secondRect)) {
      return true;
    }

    const { gapX, gapY } = getRectangleGap(firstRect, secondRect);
    const isAxisNearby =
      (gapX <= axisNearGap && gapY === 0) ||
      (gapY <= axisNearGap && gapX === 0);
    const isDiagonalNearby = gapX <= diagonalNearGap && gapY <= diagonalNearGap;

    if (!isAxisNearby && !isDiagonalNearby) {
      return false;
    }

    const unionRect = firstRect.union(secondRect);
    const unionArea = getRectangleArea(unionRect);
    const combinedArea =
      getRectangleArea(firstRect) + getRectangleArea(secondRect);
    const extraArea = unionArea - combinedArea;

    if (extraArea <= maxExtraArea) {
      return true;
    }

    if (combinedArea <= 0) {
      return true;
    }

    return unionArea / combinedArea <= maxGrowthRatio;
  }

  function mergeNormalizedRectangles(rects = [], thresholds) {
    const mergedRects = [];

    for (const rect of rects) {
      let candidateRect = rect;
      let mergedIndex = 0;

      while (mergedIndex < mergedRects.length) {
        if (
          shouldMergeWithOptions(
            mergedRects[mergedIndex],
            candidateRect,
            thresholds,
          )
        ) {
          candidateRect = mergedRects[mergedIndex].union(candidateRect);
          mergedRects.splice(mergedIndex, 1);
          mergedIndex = 0;
          continue;
        }
        mergedIndex++;
      }

      mergedRects.push(candidateRect);
    }

    return mergedRects;
  }

  function collapseLargeRect(rect, thresholds) {
    const { viewportCoverageRatio, canonicalRectCoverageRatio } = thresholds;
    const viewportRect = RectangleRange.fromRectLike(getViewportRect?.());
    if (viewportRect) {
      const viewportArea = getRectangleArea(viewportRect);
      if (
        viewportArea > 0 &&
        getRectangleIntersectionArea(rect, viewportRect) / viewportArea >=
          viewportCoverageRatio
      ) {
        return [viewportRect];
      }
    }

    const canonicalRects = normalizeRectangleArray(
      getCanonicalRectsForRect?.(rect),
    );
    if (canonicalRects.length === 0) {
      return [rect];
    }

    const collapsedRects = canonicalRects.filter((canonicalRect) => {
      const canonicalArea = getRectangleArea(canonicalRect);
      if (canonicalArea <= 0) return false;

      return (
        getRectangleIntersectionArea(rect, canonicalRect) / canonicalArea >=
        canonicalRectCoverageRatio
      );
    });

    return collapsedRects.length > 0 ? collapsedRects : [rect];
  }

  return function mergeConfiguredRectangleDirtyRects(dirtyRects) {
    const thresholds = resolveMergerThresholds(options);
    const passthroughRects = [];
    const normalizedRects = [];

    for (const rect of dirtyRects) {
      const normalizedRect = RectangleRange.fromRectLike(rect);
      if (!normalizedRect) {
        passthroughRects.push(rect);
        continue;
      }

      normalizedRects.push(normalizedRect);
    }

    const mergedRects = mergeNormalizedRectangles(normalizedRects, thresholds);
    const collapsedRects = dedupeRectangles(
      mergedRects.flatMap((rect) => collapseLargeRect(rect, thresholds)),
    );
    const finalRects = mergeNormalizedRectangles(collapsedRects, thresholds);

    return [...finalRects, ...passthroughRects];
  };
}

/**
 * 合并重叠或相接的矩形脏区
 * @param {any[]} dirtyRects - 原始脏区集合
 * @returns {any[]} 合并后的脏区集合
 */
const mergeRectangleDirtyRects = createRectangleDirtyRectMerger();

/**
 * 渲染调度器
 * @description 将多次失效请求合并到单帧 flush 中执行。
 * @class
 * @author Zhou Chenyu
 */
class RenderScheduler {
  /**
   * 是否已有待执行帧
   * @type {boolean}
   */
  framePending;

  /**
   * 当前积累的脏区
   * @type {any[]}
   */
  dirtyRects;

  /**
   * 帧调度函数
   * @type {(callback: FrameRequestCallback) => number | unknown}
   */
  scheduleFrame;

  /**
   * 脏区合并函数
   * @type {(dirtyRects: any[]) => any[]}
   */
  mergeDirtyRects;

  /**
   * flush 时执行的处理器
   * @type {(dirtyRects: any[]) => unknown}
   */
  flushHandler;

  /**
   * @param {{
   *   scheduleFrame?: (callback: FrameRequestCallback) => number | unknown,
   *   mergeDirtyRects?: (dirtyRects: any[]) => any[],
   *   flushHandler?: (dirtyRects: any[]) => unknown,
   * }} [options] - 调度选项
   */
  constructor(options = {}) {
    this.framePending = false;
    this.dirtyRects = [];
    this.scheduleFrame =
      options.scheduleFrame ??
      ((callback) => {
        if (typeof globalThis.requestAnimationFrame === "function") {
          return globalThis.requestAnimationFrame(callback);
        }
        return globalThis.setTimeout(() => callback(Date.now()), 16);
      });
    this.mergeDirtyRects = options.mergeDirtyRects ?? mergeRectangleDirtyRects;
    this.flushHandler = options.flushHandler ?? (() => {});
  }

  /**
   * 设置 flush 处理器
   * @param {(dirtyRects: any[]) => unknown} flushHandler - flush 回调
   */
  setFlushHandler(flushHandler) {
    this.flushHandler = flushHandler ?? (() => {});
  }

  /**
   * 提交一次失效请求
   * @param {any} [rect] - 失效脏区
   * @returns {boolean}
   */
  invalidate(rect) {
    if (rect !== undefined) {
      this.dirtyRects.push(rect);
    }

    if (this.framePending) {
      return false;
    }

    this.framePending = true;
    this.scheduleFrame(() => this.flush());
    return true;
  }

  /**
   * 清空积压脏区
   */
  clear() {
    this.dirtyRects.length = 0;
  }

  /**
   * 立即执行一次 flush
   * @returns {unknown}
   */
  flush() {
    const mergedRects = this.mergeDirtyRects([...this.dirtyRects]);
    this.framePending = false;
    this.dirtyRects.length = 0;
    return this.flushHandler(mergedRects);
  }
}

export {
  createRectangleDirtyRectMerger,
  RenderScheduler,
  mergeRectangleDirtyRects,
};
