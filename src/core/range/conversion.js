/**
 * 范围转换算法
 * @module core/range/conversion
 * @author Zhou Chenyu
 */

import { Vector } from "../utils/math.js";
import { Range } from "./range.js";

const DEFAULT_APPROXIMATION_SEGMENTS = 32;

function clonePoint(point) {
  if (point instanceof Vector) {
    return point.clone();
  }
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return new Vector(point.x, point.y);
  }
  throw new TypeError("Point must provide finite x and y coordinates");
}

function clonePoints(points) {
  if (!Array.isArray(points)) {
    throw new TypeError("Points must be an array");
  }
  return points.map((point) => clonePoint(point));
}

function collectPoints(source, options = {}) {
  if (source instanceof Range) {
    return source.toPoints(options);
  }
  return clonePoints(source);
}

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