/**
 * 矩形范围
 * @module core/range/rectangle
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../utils/math.js";
import { clonePoint, computeBounds } from "./conversion.js";
import { Range } from "./range.js";

/**
 * 矩形范围类
 * @class
 * @author Zhou Chenyu
 * @extends Range
 */
class RectangleRange extends Range {
  /**
   * @type {number}
   */
  minX;

  /**
   * @type {number}
   */
  minY;

  /**
   * @type {number}
   */
  maxX;

  /**
   * @type {number}
   */
  maxY;

  /**
   * @constructor
   */
  constructor(minX, minY, maxX, maxY) {
    super();
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  /**
   * 对矩形范围进行矩阵变换，返回变换后的矩形范围
   * @description
   * 该方法通过将矩形的四个顶点进行矩阵变换，然后计算变换后顶点的最小外接矩形来实现对矩形范围的变换。
   * 这种方法可以处理任意的线性变换，包括旋转、缩放、倾斜等，确保变换后的范围仍然是一个矩形。
   * @param {Matrix} matrix - 用于变换的矩阵
   * @returns {RectangleRange} 变换后的矩形范围
   */
  transform(matrix) {
    const topLeft = Vector.mulMatrix(matrix, { x: this.minX, y: this.minY });
    const topRight = Vector.mulMatrix(matrix, { x: this.maxX, y: this.minY });
    const btmLeft = Vector.mulMatrix(matrix, { x: this.minX, y: this.maxY });
    const btmRight = Vector.mulMatrix(matrix, { x: this.maxX, y: this.maxY });
    return RectangleRange.from([topLeft, topRight, btmLeft, btmRight]);
  }

  /**
   * 将矩形范围平移到指定位置，返回平移后的矩形范围
   * @param {Vector} position - 平移的目标位置
   * @returns {RectangleRange} 平移后的矩形范围
   */
  withPosition(position) {
    return new RectangleRange(
      this.minX + position.x,
      this.minY + position.y,
      this.maxX + position.x,
      this.maxY + position.y,
    );
  }

  /**
   * 获取矩形范围的点列
   * @returns {Array<Vector>} 矩形点列
   */
  toPoints() {
    return [
      new Vector(this.minX, this.minY),
      new Vector(this.maxX, this.minY),
      new Vector(this.maxX, this.maxY),
      new Vector(this.minX, this.maxY),
    ];
  }

  /**
   * 判断点是否落在矩形内或边界上
   * @param {Vector} point - 待判断点
   * @returns {boolean} 是否包含该点
   */
  containsPoint(point) {
    const target = clonePoint(point);
    return (
      target.x >= this.minX - 1e-8 &&
      target.x <= this.maxX + 1e-8 &&
      target.y >= this.minY - 1e-8 &&
      target.y <= this.maxY + 1e-8
    );
  }

  /**
   * 计算一组点的矩形范围
   * @param {Range} range - 要计算范围的点集
   * @returns {RectangleRange} 矩形范围
   */
  static from(range) {
    if (range instanceof RectangleRange) {
      return new RectangleRange(range.minX, range.minY, range.maxX, range.maxY);
    }
    const { minX, minY, maxX, maxY } = computeBounds(range);
    return new RectangleRange(minX, minY, maxX, maxY);
  }
}

export { RectangleRange };
