/**
 * @file 椭圆范围
 * @description 提供椭圆范围的表示、变换与近似几何运算功能。
 * @module core/range/ellipse
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../utils/math.js";
import {
  clonePoint,
  computeBounds,
  getDefaultApproximationSegments,
} from "./conversion.js";
import { getRangeSegments, pointOnSegment } from "./geometry.js";
import { Range } from "./range.js";

const ELLIPSE_EPSILON = 1e-8;

/**
 * 椭圆范围类
 * @class
 * @author Zhou Chenyu
 * @extends Range
 */
class EllipseRange extends Range {
  /**
   * 椭圆中心
   * @type {Vector}
   */
  center;

  /**
   * x 半轴向量
   * @type {Vector}
   */
  axisX;

  /**
   * y 半轴向量
   * @type {Vector}
   */
  axisY;

  /**
   * @constructor
   * @param {Vector} center - 椭圆中心
   * @param {number|Vector} axisXOrRadiusX - x 半轴长度，或半轴向量
   * @param {number|Vector} axisYOrRadiusY - y 半轴长度，或半轴向量
   */
  constructor(center, axisXOrRadiusX, axisYOrRadiusY) {
    super();
    this.center = clonePoint(center);
    if (axisXOrRadiusX instanceof Vector || axisYOrRadiusY instanceof Vector) {
      this.axisX = clonePoint(axisXOrRadiusX);
      this.axisY = clonePoint(axisYOrRadiusY);
    } else {
      this.axisX = new Vector(axisXOrRadiusX || 0, 0);
      this.axisY = new Vector(0, axisYOrRadiusY || 0);
    }
  }

  /**
   * 对椭圆范围做仿射变换。
   * @description 会同时变换中心点与两条半轴向量，并返回一个新椭圆实例。
   * @param {Matrix} matrix - 用于变换的矩阵
   * @returns {EllipseRange} 变换后的椭圆范围
   */
  transform(matrix) {
    return new EllipseRange(
      Vector.mulMatrix(matrix, this.center),
      Vector.mulMatrix(matrix, this.axisX),
      Vector.mulMatrix(matrix, this.axisY),
    );
  }

  /**
   * 将椭圆范围平移到指定位置，返回平移后的椭圆范围
   * @param {Vector} position - 平移的目标位置
   * @returns {EllipseRange} 平移后的椭圆范围
   */
  withPosition(position) {
    return new EllipseRange(this.center.add(position), this.axisX, this.axisY);
  }

  /**
   * 获取椭圆范围的点列近似
   * @param {{approximationSegments?: number}} [options] - 近似参数
   * @returns {Vector[]} 椭圆点列
   */
  toPoints(options = {}) {
    const segmentCount = Math.max(
      4,
      options.approximationSegments || getDefaultApproximationSegments(),
    );
    const points = [];
    for (let i = 0; i < segmentCount; i++) {
      const angle = (Math.PI * 2 * i) / segmentCount;
      points.push(
        this.center
          .add(this.axisX.scale(Math.cos(angle)))
          .add(this.axisY.scale(Math.sin(angle))),
      );
    }
    return points;
  }

  /**
   * 判断点是否落在椭圆内或边界上
   * @param {Vector} point - 待判断点
   * @returns {boolean} 是否包含该点
   */
  containsPoint(point) {
    const target = clonePoint(point).sub(this.center);
    const determinant =
      this.axisX.x * this.axisY.y - this.axisX.y * this.axisY.x;
    if (Math.abs(determinant) <= ELLIPSE_EPSILON) {
      return getRangeSegments(this).some(([start, end]) =>
        pointOnSegment(target.add(this.center), start, end),
      );
    }
    const factorX =
      (target.x * this.axisY.y - target.y * this.axisY.x) / determinant;
    const factorY =
      (this.axisX.x * target.y - this.axisX.y * target.x) / determinant;
    return factorX * factorX + factorY * factorY <= 1 + ELLIPSE_EPSILON;
  }

  /**
   * 创建椭圆范围
   * @param {Range|Array<Vector>} range - 用于创建新范围的原始范围
   * @returns {EllipseRange} 椭圆范围
   */
  static from(range) {
    if (range instanceof EllipseRange) {
      return new EllipseRange(range.center, range.axisX, range.axisY);
    }
    const bounds = computeBounds(range);
    return new EllipseRange(
      new Vector(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
      bounds.width / 2,
      bounds.height / 2,
    );
  }
}

export { EllipseRange };
