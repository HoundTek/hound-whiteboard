/**
 * @file 绳子范围
 * @description 提供基于点列的绳子范围表示与变换功能。
 * @module core/engine/range/rope
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../utils/math.js";
import { clonePoint, clonePoints, collectPoints } from "./conversion.js";
import { containsPointInRope } from "./geometry.js";
import { Range } from "./range.js";

/**
 * 绳子范围类
 * @class
 * @author Zhou Chenyu
 * @extends Range
 */
class RopeRange extends Range {
  /**
   * 绳子点列
   * @type {Array<Vector>}
   */
  points;

  /**
   * @constructor
   * @param {Array<Vector>} points - 绳子点列
   */
  constructor(points) {
    super();
    this.points = clonePoints(points || []);
  }

  /**
   * 对绳子范围做仿射变换。
   * @description 返回一个新绳子实例，原点列不会被原地修改。
   * @param {Matrix} matrix - 用于变换的矩阵
   * @returns {RopeRange} 变换后的绳子范围
   */
  transform(matrix) {
    return new RopeRange(
      this.points.map((point) => Vector.mulMatrix(matrix, point)),
    );
  }

  /**
   * 将绳子范围平移到指定位置，返回平移后的绳子范围
   * @param {Vector} position - 平移的目标位置
   * @returns {RopeRange} 平移后的绳子范围
   */
  withPosition(position) {
    return new RopeRange(this.points.map((p) => p.add(position)));
  }

  /**
   * 获取绳子范围的点列
   * @returns {Array<Vector>} 绳子点列
   */
  toPoints() {
    return clonePoints(this.points);
  }

  /**
   * 判断点是否落在绳子围成的区域内或边界上
   * @param {Vector} point - 待判断点
   * @returns {boolean} 是否包含该点
   */
  containsPoint(point) {
    return containsPointInRope(this.points, clonePoint(point));
  }

  /**
   * 创建绳子范围
   * @param {Range} range - 用于创建新范围的原始范围
   * @returns {RopeRange} 绳子范围
   */
  static from(range) {
    if (range instanceof RopeRange) {
      return new RopeRange(range.points);
    }
    return new RopeRange(collectPoints(range));
  }
}

export { RopeRange };
