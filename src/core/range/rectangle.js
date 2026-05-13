/**
 * @file 矩形范围
 * @module core/range/rectangle
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../utils/math.js";

/**
 * 矩形范围类
 * @class
 * @author Zhou Chenyu
 */
class RectangleRange {
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

  constructor(minX, minY, maxX, maxY) {
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
  mulMatrix(matrix) {
    const topLeft = Vector.mulMatrix(matrix, { x: this.minX, y: this.minY });
    const topRight = Vector.mulMatrix(matrix, { x: this.maxX, y: this.minY });
    const bottomLeft = Vector.mulMatrix(matrix, { x: this.minX, y: this.maxY });
    const bottomRight = Vector.mulMatrix(matrix, { x: this.maxX, y: this.maxY });
    return RectangleRange.calculate([
      topLeft,
      topRight,
      bottomLeft,
      bottomRight,
    ]);
  }

  /**
   * 计算一组点的矩形范围
   * @param {Vector[]} points - 要计算范围的点集
   * @returns {RectangleRange} 矩形范围
   */
  static calculate(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return new RectangleRange(minX, minY, maxX, maxY);
  }
}

export {
  RectangleRange,
};
