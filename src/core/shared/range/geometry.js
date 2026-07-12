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
import {
  RANGE_EPSILON,
  anyPointContained,
  anySegmentIntersection,
  crossProduct,
  getRangeSegments,
  pointOnSegment,
  segmentsIntersect,
} from "./segment-math.js";

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
