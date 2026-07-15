/**
 * @file 多边形范围
 * @description 提供多边形范围的表示、点包含与包围盒计算功能。
 * @module core/engine/range/polygon
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../utils/math.js";
import { clonePoint, clonePoints, collectPoints } from "./conversion.js";
import { containsPointInPolygon } from "./geometry.js";
import { Range } from "./range.js";

/**
 * 多边形范围类
 * @class
 * @author Zhou Chenyu
 * @extends Range
 */
class PolygonRange extends Range {
  /**
   * 多边形点列
   * @type {Array<Vector>}
   */
  points;

  /**
   * @constructor
   * @param {Array<Vector>} points - 多边形点列
   */
  constructor(points) {
    super();
    this.points = clonePoints(points || []);
  }

  /**
   * 对多边形范围做仿射变换
   * @description 返回一个新多边形实例，原点列不会被原地修改。
   * @param {Matrix} matrix - 用于变换的矩阵
   * @returns {PolygonRange} 变换后的多边形范围
   */
  transform(matrix) {
    return new PolygonRange(
      this.points.map((p) => Vector.mulMatrix(matrix, p)),
    );
  }

  /**
   * 将多边形范围平移到指定位置，返回平移后的多边形范围
   * @param {Vector} position - 平移的目标位置
   * @returns {PolygonRange} 平移后的多边形范围
   */
  withPosition(position) {
    return new PolygonRange(this.points.map((p) => p.add(position)));
  }

  /**
   * 获取多边形范围的点列
   * @returns {Array<Vector>} 多边形点列
   */
  toPoints() {
    return clonePoints(this.points);
  }

  /**
   * 判断点是否落在多边形内或边界上
   * @param {Vector} point - 待判断点
   * @returns {boolean} 是否包含该点
   */
  containsPoint(point) {
    return containsPointInPolygon(this.points, clonePoint(point));
  }

  /**
   * 创建多边形范围
   * @param {Range} range - 用于创建新范围的原始范围
   * @returns {PolygonRange} 多边形范围
   */
  static from(range) {
    if (range instanceof PolygonRange) {
      return new PolygonRange(range.points);
    }
    return new PolygonRange(collectPoints(range));
  }
}

export { PolygonRange };
