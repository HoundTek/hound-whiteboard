/**
 * 路径范围
 * @module core/range/path
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../utils/math.js";
import { clonePoint, clonePoints, collectPoints } from "./conversion.js";
import { getRangeSegments, pointOnSegment } from "./geometry.js";
import { Range } from "./range.js";

/**
 * 路径范围类
 * @class
 * @author Zhou Chenyu
 * @extends Range
 */
class PathRange extends Range {
  /**
   * @type {Array<Vector>}
   */
  points;

  /**
   * @type {boolean}
   */
  closed;

  /**
   * @constructor
   * @param {Array<Vector>} points - 路径点列
   * @param {boolean} [closed=false] - 是否闭合
   */
  constructor(points, closed = false) {
    super();
    this.points = clonePoints(points || []);
    this.closed = closed;
  }

  /**
   * @param {Matrix} matrix - 用于变换的矩阵
   * @returns {PathRange} 变换后的路径范围
   */
  transform(matrix) {
    return new PathRange(
      this.points.map((p) => matrix.mulVector(p.clone())),
      this.closed,
    );
  }

  /**
   * 将路径范围平移到指定位置，返回平移后的路径范围
   * @param {Vector} position - 平移的目标位置
   * @returns {PathRange} 平移后的路径范围
   */
  withPosition(position) {
    return new PathRange(
      this.points.map((p) => p.add(position)),
      this.closed,
    );
  }

  /**
   * 获取路径范围的点列
   * @returns {Array<Vector>} 路径点列
   */
  toPoints() {
    return clonePoints(this.points);
  }

  /**
   * 当前路径是否闭合
   * @returns {boolean} 是否闭合
   */
  isClosed() {
    return this.closed;
  }

  /**
   * 判断点是否落在路径上
   * @param {Vector} point - 待判断点
   * @returns {boolean} 是否在路径上
   */
  containsPoint(point) {
    const target = clonePoint(point);
    return getRangeSegments(this).some(([start, end]) =>
      pointOnSegment(target, start, end),
    );
  }

  /**
   * 创建路径范围
   * @param {Range|Array<Vector>} range - 用于创建新范围的原始范围
   * @returns {PathRange} 路径范围
   */
  static from(range) {
    if (range instanceof PathRange) {
      return new PathRange(range.points, range.closed);
    }
    const points = collectPoints(range);
    const closed = range instanceof Range ? range.isClosed() : false;
    return new PathRange(points, closed);
  }
}

export { PathRange };
