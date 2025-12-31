/**
 * @file 基本对象定义
 * @description
 * 定义白板系统中使用的基础类，包括:
 * - 基础对象 BasicObject
 * - 零维对象 ZeroDimensionObject: BasicObject
 * - 一维对象 OneDimensionObject: BasicObject
 * - 二维对象 TwoDimensionObject: BasicObject
 * @module basic-classes
 * @author Zhou Chenyu
 */

const { Matrix, Point } = require("../../utils/math");

/**
 * 所有白板对象的抽象基类
 * @abstract
 * @class
 * @description 定义了所有白板对象的通用属性和方法，包括位置、变换、边界等
 * @author Zhou Chenyu
 */
class BasicObject {
  /**
   * 对象的 id
   * @type {number}
   */
  id;

  /**
   * 对象所在的页 id
   * @type {number}
   */
  pageId;

  /**
   * 对象的位置
   * @type {Point}
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
   * @type {Matrix}
   * @description 存储对象的边界矩形，用于碰撞检测和选择。
   * 格式为 [[minX, maxX], [minY, maxY]]。
   */
  rectangle;

  /**
   * 对象的凸包
   * @type {Point[]}
   * @description 用于更迅速的碰撞检测，存储凸包的顶点坐标。
   */
  convexHull;

  /**
   * 计算对象的凸包
   * @description 统一 API，子类可重写此方法以计算对象的凸包。默认是矩形边界。
   */
  calculateConvexHull() {
    this.convexHull = this.rectangle;
  }

  /**
   * 判断某点是否在对象内
   * @param {Point} p - 要检测的点
   * @returns {boolean} 点是否在对象内
   * @description 基类使用矩形边界进行检测，子类可重写此方法以实现更精确的检测逻辑。
   */
  isPointIntersect(p) {
    return !(
      this.rectangle.a <= p.x &&
      p.x <= this.rectangle.b &&
      this.rectangle.c <= p.y &&
      p.y <= this.rectangle.d
    );
  }

  /**
   * 标识对象是否是有向对象
   * @private
   * @type {boolean}
   * @readonly
   * @description 有向对象可以自定义旋转中心
   */
  #isDirected = false;

  /**
   * 获取对象是否是有向对象
   * @returns {boolean} 是否是有向对象
   */
  get isDirected() {
    return this.#isDirected;
  }

  /**
   * 该对象是否是可擦对象
   * @private
   * @type {boolean}
   * @readonly
   */
  #isErasable = false;

  /**
   * 获取对象是否是可擦对象
   * @returns {boolean} 是否是可擦对象
   */
  get isErasable() {
    return this.#isErasable;
  }

  /**
   * 创建一个新的基础对象
   * @param {Point} p - 对象的初始位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 对象所在页的 id
   * @param {boolean} [erasable = false] - 对象是否为可擦对象
   * @param {boolean} [directed = false] - 对象是否为有向对象
   * @constructor
   */
  constructor(p, id, pageId, erasable = false, directed = false) {
    this.position = p;
    this.id = id;
    this.pageId = pageId;
    this.#isErasable = erasable;
    this.#isDirected = directed;
  }

  /**
   * 设置对象的变换矩阵
   *
   * **⚠ [warning] 你应该使用此方法而不是直接修改 transform ⚠**
   * @param {Matrix} trans - 新的变换矩阵
   */
  setTransform(trans) {
    this.transform = trans;
  }

  /**
   * 应用变换矩阵到对象
   * @param {Matrix} trans - 要应用的变换矩阵
   * @description 将变换矩阵与当前变换矩阵相乘
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
   * @throws {Error} 基类未实现此方法
   */
  serialize() {
    throw new Error("Method not implemented.");
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

/**
 * 零维对象抽象基类
 * @abstract
 * @class
 * @extends BasicObject
 * @description 表示零维对象，对象自身没有长度和宽度
 * @author Zhou Chenyu
 */
class ZeroDimensionObject extends BasicObject {}

/**
 * 一维对象抽象基类
 * @abstract
 * @class
 * @extends BasicObject
 * @description 表示一维对象，对象自身只有长度没有宽度 (或只有长度没有宽度)
 * @author Zhou Chenyu
 */
class OneDimensionObject extends BasicObject {
  /**
   * 标识该一维对象的主轴是否是 x 轴
   * @private
   * @type {boolean}
   * @default true
   * @description true 表示主轴是 x 轴（水平），false 表示主轴是 y 轴（垂直）
   */
  #isMainAxisX = true;

  /**
   * 获取该一维对象的主轴是否是 x 轴
   * @returns {boolean} 主轴是否是 x 轴
   */
  get isMainAxisX() {
    return this.#isMainAxisX;
  }

  /**
   * 创建一个新的一维对象
   * @param {Point} p - 对象的初始位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 对象所在页的 id
   * @param {boolean} [erasable = false] - 对象是否为可擦对象
   * @param {boolean} [directed = false] - 对象是否为有向对象
   * @param {boolean} [xAxis = true]
   * @constructor
   */
  constructor(p, id, pageId, erasable = false, directed = false, xAxis = true) {
    super(p, id, pageId, erasable, directed);
    this.#isMainAxisX = xAxis;
  }
}

/**
 * 二维对象抽象基类
 * @abstract
 * @class
 * @extends BasicObject
 * @description 表示二维对象，自身有长度和宽度
 * @author Zhou Chenyu
 */
class TwoDimensionObject extends BasicObject {}

module.exports = {
  BasicObject,
  ZeroDimensionObject,
  OneDimensionObject,
  TwoDimensionObject,
};
