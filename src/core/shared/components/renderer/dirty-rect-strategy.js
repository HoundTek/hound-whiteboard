/**
 * @file dirty rect 策略
 * @description 聚合 Core 专属的 chunk 脏区解析逻辑，并兼容导出共享 dirty rect 策略函数。
 * @module core/shared/components/renderer/dirty-rect-strategy
 * @author Zhou Chenyu
 */

import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { intersectsRanges } from "../../range/geometry.js";
import { RectangleRange } from "../../range/rectangle.js";
import {
  createBaseDirtyRectThresholdStrategy,
  createDirtyRectPolicyResolver,
  createDirtyRectThresholdStrategy,
  createLiveDirtyRectPolicyResolver,
  createLiveDirtyRectThresholdStrategy,
  createZoomOffsetThresholdStrategy,
  createZoomScaledThresholdStrategy,
  normalizeDirtyRectZoomScale,
  screenRectToWorldRect,
} from "./dirty-rect-strategy-shared.js";

/**
 * 收集世界坐标矩形覆盖到的已加载区块
 * @description
 * 先计算世界矩形覆盖的 chunk id 集合，再过滤出 buffer 中已加载的 chunk 实例。
 * 这是 base 层 canonical rect 解析所需的 Core 专属步骤，不属于共享策略函数。
 * @param {RectangleRange | Object} worldRect - 世界坐标矩形
 * @param {Object} [options = {}] - chunk 查询配置
 * @param {Array} [options.loadedChunks = []] - 当前已加载的 chunk 数组
 * @param {Function} [options.getChunkById] - 按 id 获取 chunk 实例的回调
 * @param {number} [options.chunkWidth = 0] - 单个 chunk 宽度
 * @param {number} [options.chunkHeight = 0] - 单个 chunk 高度
 * @returns {Array} 命中的已加载 chunk 实例数组
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
 * 这是依赖 ChunkObjectManager 的 Core 专属逻辑。
 * @param {Object} [options = {}] - 解析配置
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
 * 创建 base 层 dirty rect policy 解析器
 * @description
 * 组装 base 层的阈值策略、视口回调与 canonical rect 解析。
 * 当未显式传入 `getCanonicalRectsForRect` 时，回退到基于 chunk 的 Core 专属解析器。
 * @param {Object} [options = {}] - policy 配置
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

export {
  collectLoadedChunksForWorldRect,
  createBaseDirtyRectCanonicalRectsResolver,
  createBaseDirtyRectPolicyResolver,
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
