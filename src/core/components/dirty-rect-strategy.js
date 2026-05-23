/**
 * @file dirty rect 策略
 * @module core/components/dirty-rect-strategy
 * @author Zhou Chenyu
 */

import { ChunkObjectManager } from "./chunk-object-manager.js";
import { intersectsRanges } from "../range/geometry.js";
import { RectangleRange } from "../range/rectangle.js";

function normalizeDirtyRectZoomScale(zoom = 1) {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function clampDirtyRectThresholdValue(value, min = -Infinity, max = Infinity) {
  return Math.min(max, Math.max(min, value));
}

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

function resolveThresholdStrategyValue(strategyValue, zoom = 1) {
  return typeof strategyValue === "function"
    ? strategyValue(zoom)
    : strategyValue;
}

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

function collectLoadedChunksForWorldRect(
  worldRect,
  {
    loadedChunks = [],
    getChunkById,
    chunkWidth = 0,
    chunkHeight = 0,
  } = {},
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

  return [...ChunkObjectManager.calculateCoveredChunkIdsForRange(
    normalizedWorldRect,
    chunkWidth,
    chunkHeight,
  )]
    .filter((chunkId) => loadedChunkIds.has(chunkId))
    .map((chunkId) => getChunkById?.(chunkId))
    .filter(Boolean);
}

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
        (chunkRect) => chunkRect && intersectsRanges(chunkRect, normalizedDirtyRect),
      );
  };
}

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

function createBaseDirtyRectPolicyResolver(options = {}) {
  const resolveBaseThresholds = createBaseDirtyRectThresholdStrategy();
  const resolveBaseCanonicalRectsForDirtyRect =
    options.getCanonicalRectsForRect ??
    createBaseDirtyRectCanonicalRectsResolver(options);

  return createDirtyRectPolicyResolver({
    getThresholds:
      options.getThresholds ?? (() => resolveBaseThresholds(options.getZoom?.())),
    getViewportRect: options.getViewportRect,
    getCanonicalRectsForRect: resolveBaseCanonicalRectsForDirtyRect,
  });
}

function createLiveDirtyRectPolicyResolver(options = {}) {
  const resolveLiveThresholds = createLiveDirtyRectThresholdStrategy();

  return createDirtyRectPolicyResolver({
    getThresholds:
      options.getThresholds ?? (() => resolveLiveThresholds(options.getZoom?.())),
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