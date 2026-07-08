/**
 * @file 范围几何算法
 * @description 提供范围间交集、包含和段交点计算等核心几何运算。
 * @module core/shared/range/geometry
 * @author Zhou Chenyu
 */

import { ropeNailIntersect } from "../../utils/math-algorithm.js";
import { boundsIntersect, getRangeBounds, rangesMayOverlap } from "./bounds.js";
import { intersectsRangesByType } from "./intersections.js";
import { Range } from "./range.js";

const RANGE_EPSILON = 1e-8;

/**
 * 计算二维有向叉积。
 * @description 返回从 `origin` 指向 `first` 与 `second` 两个向量的叉积值。
 * @param {{x: number, y: number}} origin - 叉积原点
 * @param {{x: number, y: number}} first - 第一个点
 * @param {{x: number, y: number}} second - 第二个点
 * @returns {number} 叉积值
 */
function crossProduct(origin, first, second) {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

/**
 * 判断点是否在线段上。
 * @description 先检查共线，再检查点是否位于线段端点之间。
 * @param {{x: number, y: number}} point - 待判断点
 * @param {{x: number, y: number}} start - 线段起点
 * @param {{x: number, y: number}} end - 线段终点
 * @param {number} [eps=RANGE_EPSILON] - 浮点误差容忍值
 * @returns {boolean} 是否在线段上
 */
function pointOnSegment(point, start, end, eps = RANGE_EPSILON) {
  const cross = crossProduct(start, end, point);
  if (Math.abs(cross) > eps) {
    return false;
  }
  const dot =
    (point.x - start.x) * (point.x - end.x) +
    (point.y - start.y) * (point.y - end.y);
  return dot <= eps;
}

/**
 * 按奇偶规则判断点是否落在多边形内部。
 * @description 边界点视为包含；对自交轮廓使用 `ropeNailIntersect()` 的奇偶语义。
 * @param {Array<{x: number, y: number}>} polygon - 多边形点列
 * @param {{x: number, y: number}} point - 待判断点
 * @returns {boolean} 是否包含该点
 */
function containsPointInPolygon(polygon, point) {
  if (!polygon || polygon.length === 0) {
    return false;
  }
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    if (pointOnSegment(point, start, end)) {
      return true;
    }
  }
  const winding = ropeNailIntersect(polygon, point);
  if (Number.isNaN(winding)) {
    return true;
  }
  return Math.abs(winding) % 2 === 1;
}

/**
 * 按非零缠绕规则判断点是否落在绳子范围内部。
 * @description 边界点视为包含；对自交轮廓使用 `ropeNailIntersect()` 的非零语义。
 * @param {Array<{x: number, y: number}>} rope - 绳子点列
 * @param {{x: number, y: number}} point - 待判断点
 * @returns {boolean} 是否包含该点
 */
function containsPointInRope(rope, point) {
  if (!rope || rope.length === 0) {
    return false;
  }
  for (let i = 0; i < rope.length; i++) {
    const start = rope[i];
    const end = rope[(i + 1) % rope.length];
    if (pointOnSegment(point, start, end)) {
      return true;
    }
  }
  const winding = ropeNailIntersect(rope, point);
  if (Number.isNaN(winding)) {
    return true;
  }
  return winding !== 0;
}

/**
 * 将范围展开为边界线段集合。
 * @description 对闭合范围会自动补上末点到首点的闭合边。
 * @param {Range} range - 待展开范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {Array<[object, object]>} 线段集合
 */
function getRangeSegments(range, options = {}) {
  const points = range.toPoints(options);
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    segments.push([points[i - 1], points[i]]);
  }
  if (range.isClosed() && points.length > 2) {
    segments.push([points[points.length - 1], points[0]]);
  }
  return segments;
}

/**
 * 判断两线段是否相交。
 * @description 相交语义包括正常穿越、端点接触和共线重叠。
 * @param {{x: number, y: number}} firstStart - 第一条线段起点
 * @param {{x: number, y: number}} firstEnd - 第一条线段终点
 * @param {{x: number, y: number}} secondStart - 第二条线段起点
 * @param {{x: number, y: number}} secondEnd - 第二条线段终点
 * @param {number} [eps=RANGE_EPSILON] - 浮点误差容忍值
 * @returns {boolean} 是否相交
 */
function segmentsIntersect(
  firstStart,
  firstEnd,
  secondStart,
  secondEnd,
  eps = RANGE_EPSILON,
) {
  const c1 = crossProduct(firstStart, firstEnd, secondStart);
  const c2 = crossProduct(firstStart, firstEnd, secondEnd);
  const c3 = crossProduct(secondStart, secondEnd, firstStart);
  const c4 = crossProduct(secondStart, secondEnd, firstEnd);

  if (
    ((c1 > eps && c2 < -eps) || (c1 < -eps && c2 > eps)) &&
    ((c3 > eps && c4 < -eps) || (c3 < -eps && c4 > eps))
  ) {
    return true;
  }

  return (
    pointOnSegment(secondStart, firstStart, firstEnd, eps) ||
    pointOnSegment(secondEnd, firstStart, firstEnd, eps) ||
    pointOnSegment(firstStart, secondStart, secondEnd, eps) ||
    pointOnSegment(firstEnd, secondStart, secondEnd, eps)
  );
}

/**
 * 判断点列中是否存在被目标范围包含的点。
 * @description 只要 sourcePoints 中任一点落在 targetRange 内部或边界上，就返回 true。
 * @param {Array<object>} sourcePoints - 待检查点列
 * @param {Range} targetRange - 目标范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {boolean} 是否存在被包含的点
 */
function anyPointContained(sourcePoints, targetRange, options = {}) {
  for (const point of sourcePoints) {
    if (targetRange.containsPoint(point, options)) {
      return true;
    }
  }
  return false;
}

/**
 * 判断两范围的边界线段是否存在交点。
 * @description 会展开两侧边界线段并逐段做线段相交判定。
 * @param {Range} left - 左侧范围
 * @param {Range} right - 右侧范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {boolean} 是否存在边界交点
 */
function anySegmentIntersection(left, right, options = {}) {
  const leftSegments = getRangeSegments(left, options);
  const rightSegments = getRangeSegments(right, options);
  for (const [leftStart, leftEnd] of leftSegments) {
    for (const [rightStart, rightEnd] of rightSegments) {
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 用通用兜底算法判断两范围是否相交。
 * @description 先做包围盒快速排除，再检查点包含与边界线段相交。
 * @param {Range} left - 左侧范围
 * @param {Range} right - 右侧范围
 * @param {{approximationSegments?: number}} [options] - 点列近似参数
 * @returns {boolean} 是否相交
 */
function intersectsUnknownRanges(left, right, options = {}) {
  if (!rangesMayOverlap(left, right, options)) {
    return false;
  }

  const leftPoints = left.toPoints(options);
  if (anyPointContained(leftPoints, right, options)) {
    return true;
  }
  const rightPoints = right.toPoints(options);
  if (anyPointContained(rightPoints, left, options)) {
    return true;
  }
  return anySegmentIntersection(left, right, options);
}

/**
 * 判断两个范围是否相交。即两者存在至少一个公共点。
 * @param {Range} left - 第一个范围
 * @param {Range} right - 第二个范围
 * @param {{approximationSegments?: number}} [options] - 近似参数，适用于椭圆等需要近似为多边形的范围
 * @returns {boolean} 是否相交
 * @throws {TypeError} 如果输入的参数不是 Range 实例
 */
function intersectsRanges(left, right, options = {}) {
  if (!(left instanceof Range) || !(right instanceof Range)) {
    throw new TypeError("intersectsRanges() only accepts Range instances");
  }

  if (!rangesMayOverlap(left, right, options)) {
    return false;
  }

  const specializedResult = intersectsRangesByType(left, right, options);
  if (specializedResult !== null) {
    return specializedResult;
  }

  return intersectsUnknownRanges(left, right, options);
}

export {
  RANGE_EPSILON,
  crossProduct,
  pointOnSegment,
  containsPointInPolygon,
  containsPointInRope,
  boundsIntersect,
  getRangeSegments,
  getRangeBounds,
  rangesMayOverlap,
  segmentsIntersect,
  intersectsRanges,
};
