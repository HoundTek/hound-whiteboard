/**
 * 范围转换算法
 * @module core/range/conversion
 * @author Zhou Chenyu
 */

import { Vector } from "../utils/math.js";
import { Range } from "./range.js";

const DEFAULT_APPROXIMATION_SEGMENTS = 32;

/**
 * 克隆一个点对象。
 * @description 支持 `Vector` 实例和提供有限 `x`、`y` 坐标的普通对象。
 * @param {Vector|{x: number, y: number}} point - 待克隆的点
 * @returns {Vector} 克隆后的点
 * @throws {TypeError} 当输入无法提供有限坐标时抛出异常
 */
function clonePoint(point) {
  if (point instanceof Vector) {
    return point.clone();
  }
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return new Vector(point.x, point.y);
  }
  throw new TypeError("Point must provide finite x and y coordinates");
}

/**
 * 克隆一个点列。
 * @description 会逐点调用 `clonePoint()`，确保返回值中的点互不共享引用。
 * @param {Array<Vector|{x: number, y: number}>} points - 待克隆点列
 * @returns {Vector[]} 克隆后的点列
 * @throws {TypeError} 当输入不是数组时抛出异常
 */
function clonePoints(points) {
  if (!Array.isArray(points)) {
    throw new TypeError("Points must be an array");
  }
  return points.map((point) => clonePoint(point));
}

/**
 * 从范围或点列中收集统一点列。
 * @description 若 source 是 `Range`，则调用其 `toPoints()`；否则按普通点列克隆。
 * @param {Range|Array<Vector|{x: number, y: number}>} source - 范围或点列
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {Vector[]} 统一后的点列
 */
function collectPoints(source, options = {}) {
  if (source instanceof Range) {
    return source.toPoints(options);
  }
  return clonePoints(source);
}

/**
 * 计算输入点列或范围的包围盒。
 * @description 返回最小轴对齐包围盒，用于矩形构造和快速排除。
 * @param {Range|Array<Vector|{x: number, y: number}>} source - 范围或点列
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}} 包围盒
 * @throws {RangeError} 当输入不包含任何点时抛出异常
 */
function computeBounds(source, options = {}) {
  const points = collectPoints(source, options);
  if (points.length === 0) {
    throw new RangeError("Range source must contain at least one point");
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 获取默认的曲线近似分段数。
 * @description 该值用于椭圆等需要离散化点列的范围类型。
 * @returns {number} 默认近似分段数
 */
function getDefaultApproximationSegments() {
  return DEFAULT_APPROXIMATION_SEGMENTS;
}

export {
  DEFAULT_APPROXIMATION_SEGMENTS,
  clonePoint,
  clonePoints,
  collectPoints,
  computeBounds,
  getDefaultApproximationSegments,
};
