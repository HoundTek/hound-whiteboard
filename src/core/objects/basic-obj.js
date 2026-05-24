/**
 * 白板对象基类
 * @module core/objects/basic-obj
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../utils/math.js";
import { PolygonRange, RectangleRange, Range } from "../range/index.js";

/**
 * 白板对象基类
 * @abstract
 * @class
 * @description
 * 定义了所有白板对象的通用属性和方法，包括位置、变换、边界等。
 *
 * 白板上的所有对象都是零维的。
 * @author Zhou Chenyu
 */
class BasicObject {
  /**
   * 对象的 id
   * @type {number}
   */
  id;

  /**
   * 对象归属区块 id
   * @type {number}
   */
  ownerChunkId;

  /**
   * 对象的位置
   * @type {Vector}
   * @description 对象在画布上的位置坐标。
   */
  position;

  /**
   * 变换矩阵
   * @type {Matrix}
   * @default Matrix.identity()
   * @description
   * 用于对象的几何变换。
   * 外界不应直接修改它，应使用 setTransform 或 applyTransform 方法。
   */
  transform = Matrix.identity();

  /**
   * 对象的矩形边界范围
   * @type {RectangleRange}
   * @description 存储对象的边界矩形，用于碰撞检测和选择。
   * 边界矩形是相对于变换后的坐标而言的。
   */
  boundingBox;

  /**
   * 计算对象的边界矩形
   * @description 计算对象的边界矩形，子类应重写此方法以提供具体的计算逻辑。
   */
  calculateRectangle() {
    this.boundingBox = new RectangleRange(0, 0, 0, 0);
  }

  /**
   * 对象的凸包
   * @type {Range}
   * @description 用于更迅速的碰撞检测，存储凸包的顶点坐标。
   */
  convexHullRange;

  /**
   * 对象属性
   * @type {Record<string, any>}
   * @description 存放对象的渲染与行为属性，如颜色、描边宽度、字体等。
   */
  property = {};

  /**
   * 计算对象的凸包
   * @description 统一 API，子类可重写此方法以计算对象的凸包。默认是矩形边界。
   */
  calculateConvexHull() {
    this.convexHullRange = PolygonRange.from(this.boundingBox);
  }

  /**
   * 获取对象的主判定范围
   * @returns {Range} 主判定范围
   */
  getRange() {
    return this.boundingBox;
  }

  /**
   * 合并对象属性
   * @param {Record<string, any>} [property={}] - 待写入属性
   * @returns {Record<string, any>} 最新属性
   */
  setProperty(property = {}) {
    if (!property || typeof property !== "object" || Array.isArray(property)) {
      return this.property;
    }

    this.property = {
      ...(this.property ?? {}),
      ...property,
    };

    return this.property;
  }

  /**
   * 获取对象渲染额外留白
   * @description 返回值单位为对象空间中的长度，供活动层 dirty rect 在换算到屏幕空间后补足描边、端点与抗锯齿留白。
   * @returns {number} 额外留白
   */
  getRenderPadding() {
    const strokeWidthCandidates = [
      this.property?.strokeWidth,
      this.property?.width,
      this.property?.outlineWidth,
    ].filter((value) => Number.isFinite(value) && value > 0);

    if (strokeWidthCandidates.length === 0) {
      return 0;
    }

    return Math.max(...strokeWidthCandidates) / 2;
  }

  /**
   * 标识对象是否是有向对象
   * @type {boolean}
   * @static
   * @description 有向对象可以自定义旋转中心且绕该中心旋转。
   */
  isDirected() {
    throw new Error("Method not implemented.");
  }

  /**
   * 该对象是否是可擦对象
   * @type {boolean}
   * @static
   * @readonly
   * @description 可擦对象可以被对象擦除工具擦除。
   */
  isErasable() {
    throw new Error("Method not implemented.");
  }

  /**
   * 创建一个新的基础对象
   * @param {Vector} p - 对象的初始位置
   * @param {number} id - 对象 id
   * @param {number} ownerChunkId - 对象归属区块的 id
   * @constructor
   */
  constructor(p, id, ownerChunkId) {
    this.position = p;
    this.id = id;
    this.ownerChunkId = ownerChunkId;
  }

  /**
   * 设置对象的变换矩阵
   * @param {Matrix} trans - 新的变换矩阵
   * @description 你应该使用此方法而不是直接修改 transform 字段。
   */
  setTransform(trans) {
    this.transform = trans;
  }

  /**
   * 应用变换矩阵到对象
   * @param {Matrix} trans - 要应用的变换矩阵
   * @description 将变换矩阵与当前变换矩阵相乘。
   */
  applyTransform(trans) {
    this.transform = this.transform.mul(trans);
  }

  /**
   * 渲染对象到画布上下文
   * @abstract
   * @param {CanvasRenderingContext2D} ctx - 画布上下文
   * @description 子类必须实现此方法以支持对象的渲染
   * @throws {Error} 基类未实现此方法
   */
  render(ctx) {
    throw new Error("Method not implemented.");
  }

  /**
   * 将此对象序列化以持久化对象
   * @abstract
   * @returns {Object} 序列化后的对象
   * @description 子类必须实现此方法以支持对象的持久化
   */
  serialize() {
    return {
      id: this.id,
      ownerChunkId: this.ownerChunkId,
      position: this.position.serialize(),
      transform: this.transform.serialize(),
      property: { ...(this.property ?? {}) },
    };
  }

  /**
   * 将序列化的对象转化为对象实例
   * @abstract
   * @param {object} obj - 被序列化的对象
   * @returns {BasicObject} 对象实例
   * @static
   * @description 子类必须实现此方法以支持对象的持久化
   * @throws {Error} 基类未实现此方法
   */
  static parse(obj) {
    throw new Error("Method not implemented.");
  }
}

export { BasicObject };
