/**
 * @file 范围模块聚合入口
 * @description 导出范围子模块的公共接口。
 * @module core/shared/range/index
 * @author Zhou Chenyu
 */

export { Range } from "./range.js";
export { RectangleRange } from "./rectangle.js";
export { PolygonRange } from "./polygon.js";
export { RopeRange } from "./rope.js";
export { EllipseRange } from "./ellipse.js";
export { PathRange } from "./path.js";

export {
  DEFAULT_APPROXIMATION_SEGMENTS,
  clonePoint,
  clonePoints,
  collectPoints,
  computeBounds,
  getDefaultApproximationSegments,
} from "./conversion.js";

export {
  RANGE_EPSILON,
  crossProduct,
  pointOnSegment,
  containsPointInPolygon,
  containsPointInRope,
  getRangeSegments,
  segmentsIntersect,
  intersectsRanges,
} from "./geometry.js";
