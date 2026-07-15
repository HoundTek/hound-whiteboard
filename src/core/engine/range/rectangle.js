/**
 * @file 矩形范围
 * @description 提供矩形范围的表示、变换与包围盒计算功能。
 * @module core/engine/range/rectangle
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
   * 矩形左边界
   * @type {number}
   */
  left;

  /**
   * 矩形上边界
   * @type {number}
   */
  top;

  /**
   * 矩形宽度
   * @type {number}
   */
  width;

  /**
   * 矩形高度
   * @type {number}
   */
  height;

  /**
   * 矩形右边界
   * @type {number}
   */
  get right() {
    return this.left + this.width;
  }

  /**
   * 矩形下边界
   * @type {number}
   */
  get bottom() {
    return this.top + this.height;
  }

  /**
   * @constructor
   * @param {number} left - 左边界
   * @param {number} top - 上边界
   * @param {number} width - 矩形宽度
   * @param {number} height - 矩形高度
   */
  constructor(left, top, width, height) {
    super();
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;
  }

  /**
   * 对矩形范围进行矩阵变换，返回变换后的矩形范围
   * @description
   * 该方法通过将矩形的四个角点进行矩阵变换，再计算变换后角点的包围盒来实现矩形范围变换。
   * 这种方法可以处理任意的线性变换，包括旋转、缩放、倾斜等，确保变换后的范围仍然是一个矩形。
   * @param {Matrix} matrix - 用于变换的矩阵
   * @returns {RectangleRange} 变换后的矩形范围
   */
  transform(matrix) {
    const topLeft = Vector.mulMatrix(matrix, { x: this.left, y: this.top });
    const topRight = Vector.mulMatrix(matrix, { x: this.right, y: this.top });
    const btmLeft = Vector.mulMatrix(matrix, { x: this.left, y: this.bottom });
    const btmRight = Vector.mulMatrix(matrix, { x: this.right, y: this.bottom });
    return RectangleRange.from([topLeft, topRight, btmLeft, btmRight]);
  }

  /**
   * 将矩形范围平移到指定位置，返回平移后的矩形范围
   * @param {Vector} position - 平移的目标位置
   * @returns {RectangleRange} 平移后的矩形范围
   */
  withPosition(position) {
    return new RectangleRange(
      this.left + position.x,
      this.top + position.y,
      this.width,
      this.height,
    );
  }

  /**
   * 获取矩形范围的点列
   * @returns {Array<Vector>} 矩形点列
   */
  toPoints() {
    return [
      new Vector(this.left, this.top),
      new Vector(this.right, this.top),
      new Vector(this.right, this.bottom),
      new Vector(this.left, this.bottom),
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
      target.x >= this.left - 1e-8 &&
      target.x <= this.right + 1e-8 &&
      target.y >= this.top - 1e-8 &&
      target.y <= this.bottom + 1e-8
    );
  }

  /**
   * 计算两个矩形的并集包围盒
   * @param {RectangleRange | { left: number, top: number, width?: number, height?: number, right?: number, bottom?: number }} rect - 待合并矩形
   * @returns {RectangleRange} 并集包围盒
   */
  union(rect) {
    const target = RectangleRange.fromRectLike(rect);
    if (!target) {
      return RectangleRange.from(this);
    }

    const left = Math.min(this.left, target.left);
    const top = Math.min(this.top, target.top);
    const right = Math.max(this.right, target.right);
    const bottom = Math.max(this.bottom, target.bottom);

    return new RectangleRange(left, top, right - left, bottom - top);
  }

  /**
   * 扩张矩形边界
   * @param {number} padding - 四周扩张量
   * @returns {RectangleRange} 扩张后的矩形
   */
  inflate(padding) {
    return new RectangleRange(
      this.left - padding,
      this.top - padding,
      this.width + padding * 2,
      this.height + padding * 2,
    );
  }

  /**
   * 计算一组点的矩形范围
   * @param {Range} range - 要计算范围的点集
   * @returns {RectangleRange} 矩形范围
   */
  static from(range) {
    if (range instanceof RectangleRange) {
      return new RectangleRange(range.left, range.top, range.width, range.height);
    }
    return computeBounds(range);
  }

  /**
   * 统一处理矩形样输入
   * @param {RectangleRange | { left: number, top: number, width?: number, height?: number, right?: number, bottom?: number }} rect - 矩形样输入
   * @returns {RectangleRange | undefined} 规整后的矩形
   */
  static fromRectLike(rect) {
    if (!rect) return undefined;
    if (rect instanceof RectangleRange) {
      return RectangleRange.from(rect);
    }

    const left = rect.left;
    const top = rect.top;
    const width = rect.width;
    const height = rect.height;
    const right = rect.right;
    const bottom = rect.bottom;

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return undefined;
    }

    if (Number.isFinite(width) && Number.isFinite(height)) {
      return new RectangleRange(left, top, width, height);
    }

    if (Number.isFinite(right) && Number.isFinite(bottom)) {
      return new RectangleRange(left, top, right - left, bottom - top);
    }

    return undefined;
  }
}

export { RectangleRange };
