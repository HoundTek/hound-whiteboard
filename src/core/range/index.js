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