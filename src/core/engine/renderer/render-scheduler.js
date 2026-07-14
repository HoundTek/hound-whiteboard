/**
 * @file 渲染调度器
 * @description 负责脏区域合并、清理和渲染顺序的调度策略。
 * @module core/engine/renderer/render-scheduler
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

/**
 * 获取矩形面积
 * @param {{ width: number, height: number }} rect - 矩形对象
 * @returns {number}
 */
function getRectangleArea(rect) {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

/**
 * 计算两个矩形的相交面积
 * @param {{ left: number, top: number, right: number, bottom: number }} firstRect
 * @param {{ left: number, top: number, right: number, bottom: number }} secondRect
 * @returns {number}
 */
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

/**
 * 计算两个矩形在各轴上的间隔
 * @param {{ left: number, top: number, right: number, bottom: number }} firstRect
 * @param {{ left: number, top: number, right: number, bottom: number }} secondRect
 * @returns {{ gapX: number, gapY: number }}
 */
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

/**
 * 判断两个矩形是否应因相交或近邻而合并
 * @param {{ left: number, top: number, right: number, bottom: number, width: number, height: number }} firstRect
 * @param {{ left: number, top: number, right: number, bottom: number, width: number, height: number }} secondRect
 * @returns {boolean}
 */
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

/**
 * 将输入矩形数组统一规整为 RectangleRange 数组
 * @param {any[]} [rects = []] - 原始矩形集合
 * @returns {RectangleRange[]}
 */
function normalizeRectangleArray(rects = []) {
  return rects.map((rect) => RectangleRange.fromRectLike(rect)).filter(Boolean);
}

/**
 * 解析配置值，支持惰性回调形式
 * @param {any | Function} optionValue - 配置值或返回配置值的函数
 * @param {any} fallbackValue - 回退默认值
 * @returns {any}
 */
function resolveOptionValue(optionValue, fallbackValue) {
  const resolvedValue =
    typeof optionValue === "function" ? optionValue() : optionValue;

  return resolvedValue ?? fallbackValue;
}

/**
 * 从配置选项中解析完整的脏区合并阈值集合
 * @description
 * 优先从 options.getThresholds() 回调读取分组阈值，
 * 再允许单个字段覆盖，最终回退到默认值。
 * @param {Object} [options = {}] - 合并配置
 * @param {Function} [options.getThresholds] - 返回分组阈值的回调
 * @param {number} [options.axisNearGap] - 轴向近邻最大间距
 * @param {number} [options.diagonalNearGap] - 对角近邻最大间距
 * @param {number} [options.maxExtraArea] - 合并允许的最大额外扫描面积
 * @param {number} [options.maxGrowthRatio] - 合并后面积增长最大比例
 * @param {number} [options.viewportCoverageRatio] - 退化整视口的脏区覆盖比例
 * @param {number} [options.canonicalRectCoverageRatio] - 退化整 chunk 的脏区覆盖比例
 * @returns {{ axisNearGap: number, diagonalNearGap: number, maxExtraArea: number, maxGrowthRatio: number, viewportCoverageRatio: number, canonicalRectCoverageRatio: number }}
 */
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

/**
 * 去重完全相同的矩形
 * @param {any[]} [rects = []] - 矩形集合
 * @returns {any[]}
 */
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

/**
 * 创建宿主可配置的脏区矩形合并器
 * @description
 * 支持按宿主传入阈值、视口矩形（viewportCoverageRatio 退化）、
 * canonical rect 集合（canonicalRectCoverageRatio 退化）来控制合并策略。
 * 合并流程依次为：近邻合并 → canonical rect 坍塌 → 再合并。
 * @param {Object} [options = {}] - 合并配置
 * @param {Function} [options.getViewportRect] - 返回当前视口矩形的回调
 * @param {Function} [options.getCanonicalRectsForRect] - 返回给定脏区对应的 canonical rect 集合的回调
 * @returns {(dirtyRects: any[]) => any[]}
 */
function createRectangleDirtyRectMerger(options = {}) {
  const getViewportRect = options.getViewportRect;
  const getCanonicalRectsForRect = options.getCanonicalRectsForRect;

  /**
   * 判断两个矩形是否应按当前阈值合并
   * @param {RectangleRange} firstRect
   * @param {RectangleRange} secondRect
   * @param {{ axisNearGap: number, diagonalNearGap: number, maxExtraArea: number, maxGrowthRatio: number }} thresholds
   * @returns {boolean}
   */
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

  /**
   * 对已规整的矩形列表执行一轮贪心合并
   * @description
   * 每次遍历维护已合并结果集，新矩形依次尝试与已有结果合并；
   * 若发生合并则替换并重置索引，确保两两之间不会再分离。
   * @param {RectangleRange[]} [rects = []] - 已规整矩形
   * @param {{ axisNearGap: number, diagonalNearGap: number, maxExtraArea: number, maxGrowthRatio: number }} thresholds - 合并阈值
   * @returns {RectangleRange[]}
   */
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

  /**
   * 计算两个矩形的交集
   * @param {{ left: number, top: number, right: number, bottom: number }} firstRect
   * @param {{ left: number, top: number, right: number, bottom: number }} secondRect
   * @returns {RectangleRange | undefined}
   */
  function computeRectangleIntersection(firstRect, secondRect) {
    const left = Math.max(firstRect.left, secondRect.left);
    const top = Math.max(firstRect.top, secondRect.top);
    const right = Math.min(firstRect.right, secondRect.right);
    const bottom = Math.min(firstRect.bottom, secondRect.bottom);

    if (right <= left || bottom <= top) {
      return undefined;
    }

    return new RectangleRange(left, top, right - left, bottom - top);
  }

  /**
   * 将大矩形按 canonical rect 塌缩为单个或多个较小矩形
   * @description
   * 处理流程：
   * 1. 若脏区覆盖 viewport 比例 ≥ viewportCoverageRatio → 退化为整 viewport
   * 2. 遍历 canonical rect（如 chunk 屏幕矩形），对其中覆盖率 ≥ canonicalRectCoverageRatio 的退化为整 canonical rect
   * 3. 对覆盖率 < canonicalRectCoverageRatio 但 > 0 的，保留交集（不丢失脏区）
   * 4. 没有任何 canonical rect 达标时返回原始矩形
   * @param {RectangleRange} rect - 当前脏区
   * @param {{ viewportCoverageRatio: number, canonicalRectCoverageRatio: number }} thresholds - 退化阈值
   * @returns {RectangleRange[]}
   */
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

    const resultRects = [];
    let anyCollapsed = false;

    for (const canonicalRect of canonicalRects) {
      const canonicalArea = getRectangleArea(canonicalRect);
      if (canonicalArea <= 0) continue;

      const ratio =
        getRectangleIntersectionArea(rect, canonicalRect) / canonicalArea;

      if (ratio >= canonicalRectCoverageRatio) {
        // 覆盖率足够 → 退化为整 chunk 矩形
        resultRects.push(canonicalRect);
        anyCollapsed = true;
      } else if (ratio > 0) {
        // 覆盖率不足 → 保留交集，避免丢弃该 chunk 上的脏区
        const intersection = computeRectangleIntersection(rect, canonicalRect);
        if (intersection && getRectangleArea(intersection) > 0) {
          resultRects.push(intersection);
        }
      }
    }

    return anyCollapsed ? resultRects : [rect];
  }

  /**
   * 合并器的入口函数：规整 → 近邻合并 → canonical rect 塌缩 → 去重 → 再合并
   * @param {any[]} dirtyRects - 原始脏区集合（允许非 RectangleRange 类型透传）
   * @returns {any[]}
   */
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
   * 调度代次计数器
   * @description 每次 invalidate 递增，供 scheduleFrame 回调校验是否过期。
   * 外部直接调用 flush() 后也会递增，使已在途中的延迟回调自动跳过。
   * @type {number}
   * @private
   */
  #scheduleGeneration;

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
    this.#scheduleGeneration = 0;
    this.scheduleFrame =
      options.scheduleFrame ??
      ((callback) => {
        if (typeof globalThis.requestAnimationFrame === "function") {
          return globalThis.requestAnimationFrame(callback);
        }
        return globalThis.setTimeout(() => callback(Date.now()), 16);
      });
    this.mergeDirtyRects = options.mergeDirtyRects ?? mergeRectangleDirtyRects;
    this.flushHandler = options.flushHandler ?? (() => { });
  }

  /**
   * 设置 flush 处理器
   * @param {(dirtyRects: any[]) => unknown} flushHandler - flush 回调
   */
  setFlushHandler(flushHandler) {
    this.flushHandler = flushHandler ?? (() => { });
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
    const gen = ++this.#scheduleGeneration;
    this.scheduleFrame(() => {
      if (this.#scheduleGeneration !== gen) {
        return;
      }
      this.flush();
    });
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
    // 递增代次以使已在途中的延迟 scheduleFrame 回调自动跳过
    this.#scheduleGeneration++;
    return this.flushHandler(mergedRects);
  }
}

export {
  createRectangleDirtyRectMerger,
  RenderScheduler,
  mergeRectangleDirtyRects,
};
