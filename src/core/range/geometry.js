/**
 * 范围几何算法
 * @module core/range/geometry
 * @author Zhou Chenyu
 */

import { ropeNailIntersect } from "../utils/math-algorithm.js";
import { Range } from "./range.js";

const RANGE_EPSILON = 1e-8;

function crossProduct(origin, first, second) {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

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

  const leftSegments = getRangeSegments(left, options);
  const rightSegments = getRangeSegments(right, options);
  for (const [leftStart, leftEnd] of leftSegments) {
    for (const [rightStart, rightEnd] of rightSegments) {
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) {
        return true;
      }
    }
  }

  for (const point of left.toPoints(options)) {
    if (right.containsPoint(point, options)) {
      return true;
    }
  }

  for (const point of right.toPoints(options)) {
    if (left.containsPoint(point, options)) {
      return true;
    }
  }

  return false;
}

export {
  RANGE_EPSILON,
  crossProduct,
  pointOnSegment,
  containsPointInPolygon,
  containsPointInRope,
  getRangeSegments,
  segmentsIntersect,
  intersectsRanges,
};
