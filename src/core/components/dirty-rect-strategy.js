/**
 * @file dirty rect 策略
 * @description dirty rect 策略模块提供基于区域和缩放的脏区域处理策略。
 * @module core/components/dirty-rect-strategy
 * @author Zhou Chenyu
 */

import { ChunkObjectManager } from "./chunk-object-manager.js";
import { intersectsRanges } from "../range/geometry.js";
import { RectangleRange } from "../range/rectangle.js";

/**
 * 规整缩放因子
 * @param {number} [zoom = 1] 缩放因子
 * @returns {number}
 */
function normalizeDirtyRectZoomScale(zoom = 1) {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * 将阈值裁剪到指定范围内
 * @param {number} value - 原始值
 * @param {number} [min = -Infinity]
 * @param {number} [max = Infinity]
 * @returns {number}
 */
function clampDirtyRectThresholdValue(value, min = -Infinity, max = Infinity) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 创建缩放指数型阈值函数
 * @description value = baseValue * zoomScale ** exponent
 * @param {Object} [options]
 * @param {number} [options.baseValue = 0]
 * @param {number} [options.exponent = 1]
 * @param {number} [options.min = -Infinity]
 * @param {number} [options.max = Infinity]
 * @returns {(zoom?: number) => number}
 */
function createZoomScaledThresholdStrategy({
  baseValue = 0,
  exponent = 1,
  min = -Infinity,
  max = Infinity,
} = {}) {
  return function resolveZoomScaledThreshold(zoom = 1) {
    const zoomScale = normalizeDirtyRectZoomScale(zoom);

    return clampDirtyRectThresholdValue(
      baseValue * zoomScale ** exponent,
      min,
      max,
    );
  };
}

/**
 * 创建缩放偏移型阈值函数
 * @description value = baseValue + (zoomScale - 1) * zoomStep
 * @param {Object} [options]
 * @param {number} [options.baseValue = 0]
 * @param {number} [options.zoomStep = 0]
 * @param {number} [options.min = -Infinity]
 * @param {number} [options.max = Infinity]
 * @returns {(zoom?: number) => number}
 */
function createZoomOffsetThresholdStrategy({
  baseValue = 0,
  zoomStep = 0,
  min = -Infinity,
  max = Infinity,
} = {}) {
  return function resolveZoomOffsetThreshold(zoom = 1) {
    const zoomScale = normalizeDirtyRectZoomScale(zoom);

    return clampDirtyRectThresholdValue(
      baseValue + (zoomScale - 1) * zoomStep,
      min,
      max,
    );
  };
}

/**
 * 解析阈值策略值，支持函数式惰性求值
 * @param {number | Function} strategyValue - 静态值或 (zoom) => number 的回调
 * @param {number} [zoom = 1]
 * @returns {number}
 */
function resolveThresholdStrategyValue(strategyValue, zoom = 1) {
  return typeof strategyValue === "function"
    ? strategyValue(zoom)
    : strategyValue;
}

/**
 * 创建 dirty rect 阈值解析函数
 * @description 返回的函数按当前 zoom 解析出一组完整的合并阈值。
 * @param {Object} [thresholds = {}] - 阈值配置，每项可为静态值或 zoom-aware 函数
 * @returns {(zoom?: number) => Record<string, number | undefined>}
 */
function createDirtyRectThresholdStrategy(thresholds = {}) {
  return function resolveDirtyRectThresholds(zoom = 1) {
    const zoomScale = normalizeDirtyRectZoomScale(zoom);

    return {
      axisNearGap: resolveThresholdStrategyValue(
        thresholds.axisNearGap,
        zoomScale,
      ),
      diagonalNearGap: resolveThresholdStrategyValue(
        thresholds.diagonalNearGap,
        zoomScale,
      ),
      maxExtraArea: resolveThresholdStrategyValue(
        thresholds.maxExtraArea,
        zoomScale,
      ),
      maxGrowthRatio: resolveThresholdStrategyValue(
        thresholds.maxGrowthRatio,
        zoomScale,
      ),
      viewportCoverageRatio: resolveThresholdStrategyValue(
        thresholds.viewportCoverageRatio,
        zoomScale,
      ),
      canonicalRectCoverageRatio: resolveThresholdStrategyValue(
        thresholds.canonicalRectCoverageRatio,
        zoomScale,
      ),
    };
  };
}

/**
 * 创建 dirty rect policy 解析函数
 * @description 返回的函数聚合一整组 policy（阈值回调、视口回调、canonical rect 回调）。
 * @param {Object} [options]
 * @param {Function} [options.getThresholds = () => ({})]
 * @param {Function} [options.getViewportRect]
 * @param {Function} [options.getCanonicalRectsForRect]
 * @returns {Function}
 */
function createDirtyRectPolicyResolver({
  getThresholds = () => ({}),
  getViewportRect,
  getCanonicalRectsForRect,
} = {}) {
  return function resolveDirtyRectPolicy() {
    return {
      getThresholds,
      getViewportRect,
      getCanonicalRectsForRect,
    };
  };
}

/**
 * 将屏幕脏区换算为世界坐标脏区
 * @param {RectangleRange | Object} rect - 屏幕坐标矩形
 * @param {{ x: number, y: number }} [origin = { x: 0, y: 0 }] - 视口原点
 * @param {number} [zoom = 1] - 缩放因子
 * @returns {RectangleRange | undefined}
 */
function screenRectToWorldRect(rect, origin = { x: 0, y: 0 }, zoom = 1) {
  const normalizedRect = RectangleRange.fromRectLike(rect);
  if (!normalizedRect) return undefined;

  const zoomScale = normalizeDirtyRectZoomScale(zoom);

  return new RectangleRange(
    normalizedRect.left / zoomScale + (origin?.x ?? 0),
    normalizedRect.top / zoomScale + (origin?.y ?? 0),
    normalizedRect.width / zoomScale,
    normalizedRect.height / zoomScale,
  );
}

/**
 * 收集世界坐标矩形覆盖到的已加载区块
 * @description 先计算世界矩形覆盖的 chunk id 集合，再过滤出 buffer 中已加载的 chunk 实例。
 * @param {RectangleRange | Object} worldRect - 世界坐标矩形
 * @param {Object} [options]
 * @param {Array} [options.loadedChunks = []] - 当前已加载的 chunk 数组
 * @param {Function} [options.getChunkById] - 按 id 获取 chunk 实例的回调
 * @param {number} [options.chunkWidth = 0]
 * @param {number} [options.chunkHeight = 0]
 * @returns {Array}
 */
function collectLoadedChunksForWorldRect(
  worldRect,
  { loadedChunks = [], getChunkById, chunkWidth = 0, chunkHeight = 0 } = {},
) {
  const normalizedWorldRect = RectangleRange.fromRectLike(worldRect);
  if (!normalizedWorldRect || chunkWidth <= 0 || chunkHeight <= 0) {
    return [];
  }

  const loadedChunkIds = new Set(
    loadedChunks
      .map((chunk) => chunk?.id)
      .filter((chunkId) => Number.isInteger(chunkId)),
  );

  return [
    ...ChunkObjectManager.calculateCoveredChunkIdsForRange(
      normalizedWorldRect,
      chunkWidth,
      chunkHeight,
    ),
  ]
    .filter((chunkId) => loadedChunkIds.has(chunkId))
    .map((chunkId) => getChunkById?.(chunkId))
    .filter(Boolean);
}

/**
 * 创建 base 层的 canonical rect 解析器
 * @description
 * 给定一个屏幕脏区，解析出它对应的已加载 chunk 的屏幕矩形（canonical rect）。
 * 流程：屏幕脏区 → 世界脏区 → 覆盖 chunk id → 已加载 chunk → chunk 屏幕矩形。
 * chunk 是存储单元，不直接影响渲染定位，此转换仅用于脏区塌缩策略。
 * @param {Object} [options]
 * @returns {(dirtyRect: any) => RectangleRange[]}
 */
function createBaseDirtyRectCanonicalRectsResolver({
  getOrigin = () => ({ x: 0, y: 0 }),
  getZoom = () => 1,
  getLoadedChunks = () => [],
  getChunkById,
  getChunkWidth = () => 0,
  getChunkHeight = () => 0,
  getChunkScreenRect,
} = {}) {
  return function resolveBaseCanonicalRectsForDirtyRect(dirtyRect) {
    const normalizedDirtyRect = RectangleRange.fromRectLike(dirtyRect);
    if (!normalizedDirtyRect) return [];

    const worldRect = screenRectToWorldRect(
      normalizedDirtyRect,
      getOrigin?.(),
      getZoom?.(),
    );
    if (!worldRect) return [];

    return collectLoadedChunksForWorldRect(worldRect, {
      loadedChunks: getLoadedChunks?.() ?? [],
      getChunkById,
      chunkWidth: getChunkWidth?.(),
      chunkHeight: getChunkHeight?.(),
    })
      .map((chunk) => RectangleRange.fromRectLike(getChunkScreenRect?.(chunk)))
      .filter(
        (chunkRect) =>
          chunkRect && intersectsRanges(chunkRect, normalizedDirtyRect),
      );
  };
}

/**
 * 创建 base 层默认阈值策略
 * @param {Object} [overrides = {}] - 覆盖项
 * @returns {(zoom?: number) => Record<string, number | undefined>}
 */
function createBaseDirtyRectThresholdStrategy(overrides = {}) {
  return createDirtyRectThresholdStrategy({
    axisNearGap: createZoomScaledThresholdStrategy({ baseValue: 6 }),
    diagonalNearGap: createZoomScaledThresholdStrategy({ baseValue: 3 }),
    maxExtraArea: createZoomScaledThresholdStrategy({
      baseValue: 160,
      exponent: 2,
    }),
    maxGrowthRatio: 1.2,
    viewportCoverageRatio: createZoomOffsetThresholdStrategy({
      baseValue: 0.92,
      zoomStep: 0.03,
      max: 0.98,
    }),
    canonicalRectCoverageRatio: createZoomOffsetThresholdStrategy({
      baseValue: 0.55,
      zoomStep: 0.1,
      max: 0.8,
    }),
    ...overrides,
  });
}

/**
 * 创建 live 层默认阈值策略
 * @param {Object} [overrides = {}] - 覆盖项
 * @returns {(zoom?: number) => Record<string, number | undefined>}
 */
function createLiveDirtyRectThresholdStrategy(overrides = {}) {
  return createDirtyRectThresholdStrategy({
    axisNearGap: createZoomScaledThresholdStrategy({ baseValue: 12 }),
    diagonalNearGap: createZoomScaledThresholdStrategy({ baseValue: 6 }),
    maxExtraArea: createZoomScaledThresholdStrategy({
      baseValue: 384,
      exponent: 2,
    }),
    maxGrowthRatio: 1.5,
    viewportCoverageRatio: createZoomOffsetThresholdStrategy({
      baseValue: 0.72,
      zoomStep: 0.08,
      max: 0.92,
    }),
    ...overrides,
  });
}

/**
 * 创建 base 层 dirty rect policy 解析器
 * @description 组装 base 层的阈值策略、视口回调与 canonical rect 解析。
 * @param {Object} [options = {}]
 * @returns {Function}
 */
function createBaseDirtyRectPolicyResolver(options = {}) {
  const resolveBaseThresholds = createBaseDirtyRectThresholdStrategy();
  const resolveBaseCanonicalRectsForDirtyRect =
    options.getCanonicalRectsForRect ??
    createBaseDirtyRectCanonicalRectsResolver(options);

  return createDirtyRectPolicyResolver({
    getThresholds:
      options.getThresholds ??
      (() => resolveBaseThresholds(options.getZoom?.())),
    getViewportRect: options.getViewportRect,
    getCanonicalRectsForRect: resolveBaseCanonicalRectsForDirtyRect,
  });
}

/**
 * 创建 live 层 dirty rect policy 解析器
 * @description 组装 live 层的阈值策略与视口回调（无 canonical rect 解析）。
 * @param {Object} [options = {}]
 * @returns {Function}
 */
function createLiveDirtyRectPolicyResolver(options = {}) {
  const resolveLiveThresholds = createLiveDirtyRectThresholdStrategy();

  return createDirtyRectPolicyResolver({
    getThresholds:
      options.getThresholds ??
      (() => resolveLiveThresholds(options.getZoom?.())),
    getViewportRect: options.getViewportRect,
    getCanonicalRectsForRect: options.getCanonicalRectsForRect,
  });
}

export {
  collectLoadedChunksForWorldRect,
  createBaseDirtyRectPolicyResolver,
  createBaseDirtyRectCanonicalRectsResolver,
  createBaseDirtyRectThresholdStrategy,
  createDirtyRectPolicyResolver,
  createDirtyRectThresholdStrategy,
  createLiveDirtyRectPolicyResolver,
  createLiveDirtyRectThresholdStrategy,
  createZoomOffsetThresholdStrategy,
  createZoomScaledThresholdStrategy,
  normalizeDirtyRectZoomScale,
  screenRectToWorldRect,
};
