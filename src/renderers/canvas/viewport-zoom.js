/**
 * @file 视口缩放范围
 * @description 定义缩放的可用区间并提供夹取函数，UI 与渲染器共用同一份口径。
 * @module canvas/viewport-zoom
 * @author Zhou Chenyu
 */

/**
 * 最小缩放（5%）
 * @description
 * 缩小方向的成本按 1/zoom² 增长：加载窗口（视口世界矩形 2 倍）在 10% 时约 285 个区块、
 * 5% 时约 1000 个区块、2% 时会到 6000 个区块且单帧超过 100ms。5% 是实测仍可交互的下限。
 * @type {number}
 */
const MIN_VIEWPORT_ZOOM = 0.05;

/**
 * 最大缩放（3200%）
 * @description
 * 放大方向几乎免费：视口面积有界，视口外对象被裁剪，实测 32 倍单帧约 8ms、
 * 128 倍约 6ms。取 32 倍与常见白板工具的量级对齐即可。
 * @type {number}
 */
const MAX_VIEWPORT_ZOOM = 32;

/**
 * 将缩放夹取到可用区间
 * @param {number} zoom - 原始缩放
 * @returns {number} 夹取后的缩放；非法值回退为 1
 */
function clampViewportZoom(zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(MAX_VIEWPORT_ZOOM, Math.max(MIN_VIEWPORT_ZOOM, zoom));
}

export { MIN_VIEWPORT_ZOOM, MAX_VIEWPORT_ZOOM, clampViewportZoom };
