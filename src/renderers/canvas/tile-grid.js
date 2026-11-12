/**
 * @file tile 网格的坐标换算
 * @description 把缩放、设备倍率与视口原点换算成整数设备像素边界，保证相邻块共用同一条边界。
 * @module canvas/tile-grid
 * @author Zhou Chenyu
 */

/**
 * tile 在屏幕上的基准边长（CSS 像素）
 * @description
 * 实际屏幕边长落在 `[TILE_SCREEN_SIZE, 2 × TILE_SCREEN_SIZE)`：
 * 层级按缩放取整选择，档位内靠缩放本身放大。
 * @type {number}
 */
const TILE_SCREEN_SIZE = 256;

/**
 * 默认 tile 边长（CSS 像素）
 * @description 层级 0 时与基准边长相同，保留该名字供缓存与测试引用。
 * @type {number}
 */
const DEFAULT_TILE_SIZE = TILE_SCREEN_SIZE;

/**
 * 层级绝对值上限
 * @description 缩放被夹取在 5% 到 3200%，实际层级远小于该值；上限只防浮点退化。
 * @type {number}
 */
const MAX_TILE_LEVEL = 60;

/**
 * 归一化缩放
 * @param {number} zoom - 原始缩放
 * @returns {number} 可用的缩放
 */
function normalizeZoom(zoom) {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * 由缩放推导 tile 层级
 * @description
 * 取 `-floor(log2(zoom))`，使一块 tile 的屏幕边长落在 `[基准, 2 × 基准)`。
 * 层级只决定切分粒度，不决定分辨率：像素始终按当前缩放光栅化。
 * @param {number} zoom - 缩放倍率
 * @returns {number} 层级
 */
function levelForZoom(zoom) {
  // 用 0 减而不是取负，避免 zoom 为 1 时得到 -0
  const level = 0 - Math.floor(Math.log2(normalizeZoom(zoom)));
  return Math.max(-MAX_TILE_LEVEL, Math.min(MAX_TILE_LEVEL, level));
}

/**
 * 层级对应的 tile 世界边长
 * @param {number} level - 层级
 * @returns {number} 世界边长
 */
function tileWorldSize(level, baseSize = TILE_SCREEN_SIZE) {
  return baseSize * 2 ** level;
}

/**
 * 层级与缩放对应的单块屏幕边长（设备像素）
 * @description 取值恒在 `[基准 × 设备倍率, 2 × 基准 × 设备倍率)`。
 * @param {number} level - 层级
 * @param {number} zoom - 缩放倍率
 * @param {number} devicePixelRatio - 设备像素倍率
 * @returns {number} 屏幕边长（设备像素）
 */
function tileScreenSizeDevice(
  level,
  zoom,
  devicePixelRatio,
  baseSize = TILE_SCREEN_SIZE,
) {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return baseSize * 2 ** level * normalizeZoom(zoom) * ratio;
}

/**
 * 把视口原点吸附到设备像素栅格
 * @description
 * tile 贴图要求原点落在整数设备像素上：平移后若原点带小数，
 * 同一块 tile 的旧内容与新位置会相差不到一个像素，贴图时的取整会使内容错位。
 * 吸附后误差始终不超过半个设备像素，与缩放倍率无关。
 * @param {{ x: number, y: number }} origin - 世界坐标原点
 * @param {number} zoom - 缩放倍率
 * @param {number} devicePixelRatio - 设备像素倍率
 * @returns {{ x: number, y: number }} 吸附后的世界坐标原点
 */
function quantizeOriginToDevicePixel(origin, zoom, devicePixelRatio) {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const unit = normalizeZoom(zoom) * ratio;
  return {
    x: Math.round((origin?.x ?? 0) * unit) / unit,
    y: Math.round((origin?.y ?? 0) * unit) / unit,
  };
}

/**
 * 计算某条格线在世界锚定屏幕空间中的整数位置（设备像素）
 * @description
 * 格线位置只由「缩放 × 设备倍率」决定，与视口原点无关。这一点是平移能纯合成的关键：
 * 原点变化只改变贴图位置的整数偏移，块宽与块内容都不变，因此不需要重新光栅化。
 * @param {number} index - 格线序号
 * @param {number} screenSizeDevice - 单块屏幕边长（设备像素）
 * @returns {number} 整数格线位置
 */
function tileBoundaryDevice(index, screenSizeDevice) {
  return Math.round(index * screenSizeDevice);
}

/**
 * 计算单块 tile 的屏幕矩形（设备像素）
 * @description 左右边界分别取整，下一块的左边界与上一块的右边界是同一个值，
 * 因此块与块之间既没有缝隙也不会重叠。
 * @param {number} indexX - 横向块序号
 * @param {number} indexY - 纵向块序号
 * @param {number} screenSizeDevice - 单块屏幕边长（设备像素）
 * @param {{ x: number, y: number }} [originDevice={ x: 0, y: 0 }] - 视口原点（设备像素，整数）
 * @returns {{ left: number, top: number, width: number, height: number }} 屏幕矩形
 */
function tileDeviceRect(
  indexX,
  indexY,
  screenSizeDevice,
  originDevice = { x: 0, y: 0 },
) {
  const left = tileBoundaryDevice(indexX, screenSizeDevice);
  const right = tileBoundaryDevice(indexX + 1, screenSizeDevice);
  const top = tileBoundaryDevice(indexY, screenSizeDevice);
  const bottom = tileBoundaryDevice(indexY + 1, screenSizeDevice);
  return {
    left: left - originDevice.x,
    top: top - originDevice.y,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * 计算世界矩形覆盖的块序号范围
 * @param {{ left: number, top: number, right: number, bottom: number }} worldRect - 世界矩形
 * @param {number} level - 层级
 * @returns {{ minIx: number, minIy: number, maxIx: number, maxIy: number }} 块序号范围
 */
function tileRangeForWorldRect(worldRect, level, baseSize = TILE_SCREEN_SIZE) {
  const size = tileWorldSize(level, baseSize);
  return {
    minIx: Math.floor(worldRect.left / size),
    minIy: Math.floor(worldRect.top / size),
    // 右边界用 ceil 减一：恰好落在分界线上的边界不应多算一块
    maxIx: Math.ceil(worldRect.right / size) - 1,
    maxIy: Math.ceil(worldRect.bottom / size) - 1,
  };
}

/**
 * 计算单块 tile 的世界矩形
 * @param {number} indexX - 横向块序号
 * @param {number} indexY - 纵向块序号
 * @param {number} level - 层级
 * @returns {{ left: number, top: number, width: number, height: number }} 世界矩形
 */
function tileWorldRect(indexX, indexY, level, baseSize = TILE_SCREEN_SIZE) {
  const size = tileWorldSize(level, baseSize);
  return {
    left: indexX * size,
    top: indexY * size,
    width: size,
    height: size,
  };
}

/**
 * 计算 tile 内容的绘制原点（世界坐标）
 * @description
 * 内容的世界锚定设备坐标为 `world × 缩放 × 设备倍率 - 该块边界`。绘制接口按视口原点换算，
 * 因此把原点取成 `边界 / (缩放 × 设备倍率)`，内容就与整数边界严格对齐，
 * 而且与视口原点无关，平移时无需重新光栅化。
 * @param {number} boundaryDevice - 该块的世界锚定边界（设备像素）
 * @param {number} zoom - 缩放倍率
 * @param {number} devicePixelRatio - 设备像素倍率
 * @returns {number} 世界坐标原点
 */
function tileContentOrigin(boundaryDevice, zoom, devicePixelRatio) {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return boundaryDevice / (normalizeZoom(zoom) * ratio);
}

/**
 * 计算 tile 内容在某块内的局部坐标（设备像素）
 * @description 结果与视口原点无关，只由世界坐标、缩放与块边界决定。
 * @param {number} worldCoordinate - 世界坐标（单个轴）
 * @param {number} boundaryDevice - 该块世界锚定边界（设备像素）
 * @param {number} zoom - 缩放倍率
 * @param {number} devicePixelRatio - 设备像素倍率
 * @returns {number} 局部坐标（设备像素）
 */
function tileLocalDevice(worldCoordinate, boundaryDevice, zoom, devicePixelRatio) {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return worldCoordinate * normalizeZoom(zoom) * ratio - boundaryDevice;
}

export {
  TILE_SCREEN_SIZE,
  DEFAULT_TILE_SIZE,
  MAX_TILE_LEVEL,
  levelForZoom,
  tileWorldSize,
  tileScreenSizeDevice,
  quantizeOriginToDevicePixel,
  tileBoundaryDevice,
  tileDeviceRect,
  tileRangeForWorldRect,
  tileWorldRect,
  tileContentOrigin,
  tileLocalDevice,
};
