/**
 * 白板对象基类
 * @module basic-classes
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../utils/math.js";
import { RectangleRange } from "../range/rectangle.js";

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
   * 对象归属页 id
   * @type {number}
   */
  ownerPageId;

  /**
   * 对象所在页 id 的兼容访问别名
   * @type {number}
   */
  get pageId() {
    return this.ownerPageId;
  }

  set pageId(pageId) {
    this.ownerPageId = pageId;
  }

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
  rectangle;

  /**
   * 计算对象的边界矩形
   * @description 计算对象的边界矩形，子类应重写此方法以提供具体的计算逻辑。
   */
  calculateRectangle() {
    this.rectangle = new RectangleRange(
      this.position.x,
      this.position.y,
      this.position.x,
      this.position.y,
    );
  }

  /**
   * 对象的凸包
   * @type {Vector[]}
   * @description 用于更迅速的碰撞检测，存储凸包的顶点坐标。
   */
  convexHull;

  /**
   * 计算对象的凸包
   * @description 统一 API，子类可重写此方法以计算对象的凸包。默认是矩形边界。
   */
  calculateConvexHull() {
    this.convexHull = [
      { x: this.rectangle.minX, y: this.rectangle.minY },
      { x: this.rectangle.maxX, y: this.rectangle.minY },
      { x: this.rectangle.maxX, y: this.rectangle.maxY },
      { x: this.rectangle.minX, y: this.rectangle.maxY },
    ];
  }

  /**
   * 判断某点是否在对象内
   * @param {Vector} p - 要检测的点
   * @returns {boolean} 点是否在对象内
   * @description 基类使用矩形边界进行检测，子类可重写此方法以实现更精确的检测逻辑。
   */
  isPointIntersect(p) {
    p = p.sub(this.position); // 将点 p 转换到对象的局部坐标系
    return (
      this.rectangle.minX <= p.x &&
      p.x <= this.rectangle.maxX &&
      this.rectangle.minY <= p.y &&
      p.y <= this.rectangle.maxY
    );
  }

  /**
   * 标识对象是否是有向对象
   * @type {boolean}
   * @static
   * @description 有向对象可以自定义旋转中心且绕该中心旋转。
   */
  static isDirected = false;

  /**
   * 该对象是否是可擦对象
   * @type {boolean}
   * @static
   * @readonly
   * @description 可擦对象可以被对象擦除工具擦除。
   */
  static isErasable = false;

  /**
   * 创建一个新的基础对象
   * @param {Vector} p - 对象的初始位置
   * @param {number} id - 对象 id
   * @param {number} ownerPageId - 对象归属页的 id
   * @constructor
   */
  constructor(p, id, ownerPageId) {
    this.position = p;
    this.id = id;
    this.ownerPageId = ownerPageId;
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
      ownerPageId: this.ownerPageId,
      position: this.position.serialize(),
      transform: this.transform.serialize(),
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
