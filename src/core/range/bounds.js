/**
 * @file 范围包围盒辅助算法
 * @description 提供范围包围盒获取与相交判断的辅助函数。
 * @module core/range/bounds
 * @author Zhou Chenyu
 */

import { computeBounds } from "./conversion.js";

const RANGE_BOUNDS_EPSILON = 1e-8;

/**
 * 获取范围的包围盒。
 * @description 优先直接复用矩形范围上的 left、top、width、height 字段，否则回退到通用包围盒计算，并统一返回 `RectangleRange`。
 * @param {object} range - 要计算包围盒的范围对象
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {import('./rectangle.js').RectangleRange} 范围的包围盒
 */
function getRangeBounds(range, options = {}) {
  if (
    Number.isFinite(range?.left) &&
    Number.isFinite(range?.top) &&
    Number.isFinite(range?.width) &&
    Number.isFinite(range?.height)
  ) {
    return range;
  }
  return computeBounds(range, options);
}

/**
 * 判断两个包围盒是否可能重叠。
 * @description 只要两个 `RectangleRange` 包围盒存在公共部分或边界接触，就返回 true。
 * @param {import('./rectangle.js').RectangleRange} leftBounds - 左侧包围盒
 * @param {import('./rectangle.js').RectangleRange} rightBounds - 右侧包围盒
 * @param {number} [eps=RANGE_BOUNDS_EPSILON] - 浮点误差容忍值
 * @returns {boolean} 是否重叠
 */
function boundsIntersect(leftBounds, rightBounds, eps = RANGE_BOUNDS_EPSILON) {
  return !(
    leftBounds.right < rightBounds.left - eps ||
    rightBounds.right < leftBounds.left - eps ||
    leftBounds.bottom < rightBounds.top - eps ||
    rightBounds.bottom < leftBounds.top - eps
  );
}

/**
 * 判断两个范围的包围盒是否可能重叠。
 * @description 这是范围级几何判定前的统一快速排除入口。
 * @param {object} left - 左侧范围
 * @param {object} right - 右侧范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {boolean} 两个范围的包围盒是否可能重叠
 */
function rangesMayOverlap(left, right, options = {}) {
  return boundsIntersect(
    getRangeBounds(left, options),
    getRangeBounds(right, options),
  );
}

export {
  RANGE_BOUNDS_EPSILON,
  boundsIntersect,
  getRangeBounds,
  rangesMayOverlap,
};
