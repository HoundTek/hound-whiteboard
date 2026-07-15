/**
 * @file 白板对象基类
 * @description 定义白板对象的基础属性、变换和边界接口。
 * @module core/engine/objects/basic-obj
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
   * 对象属性
   * @type {Record<string, any>}
   * @description 存放对象的渲染与行为属性，如颜色、描边宽度、字体等。
   */
  property = {};

  /**
   * 对象类型专属的持久化数据
   * @type {Record<string, any>}
   * @description 存放对象类型专属的原始数据，如圆的半径、多边形的顶点集、文本内容等。此字段直接参与序列化与反序列化。
   */
  data = {};

  /**
   * 运行时计算派生的富数据
   * @type {Record<string, any>}
   * @description 存放从原始数据计算派生的运行时结构，如边界矩形、凸包、变换后的路径等。此字段不参与持久化。
   */
  rich = {};

  /**
   * 计算对象的边界矩形
   * @description 计算对象的边界矩形，子类应重写此方法以提供具体的计算逻辑。
   */
  calculateRectangle() {
    this.rich.boundingBox = new RectangleRange(0, 0, 0, 0);
  }

  /**
   * 计算对象的凸包
   * @description 统一 API，子类可重写此方法以计算对象的凸包。默认是矩形边界。
   */
  calculateConvexHull() {
    this.rich.convexHullRange = RectangleRange.from(this.rich.boundingBox);
  }

  /**
   * 获取对象的主判定范围
   * @description 统一 API，子类可重写此方法以返回更适合的判定范围。默认是矩形边界。
   * @returns {Range} 主判定范围
   */
  getRange() {
    return this.rich.boundingBox;
  }

  /**
   * 合并对象属性
   * @param {Record<string, any>} [property={}] - 待写入属性
   * @returns {Record<string, any>} 最新属性
   */
  setProperty(property = {}) {
    Object.assign(this.property, property);
    return this.property;
  }

  /**
   * 批量更新持久化数据，自动触发派生重算
   * @param {Record<string, any>} data - 待合并的字段
   * @returns {Record<string, any>} 最新 data
   */
  setData(data) {
    Object.assign(this.data, data);
    this._onDataChange(Object.keys(data));
    return this.data;
  }

  /**
   * 向列表型字段追加一项或多项
   * @param {string} key - 字段名
   * @param {...*} items - 待追加项
   */
  appendListItem(key, ...items) {
    if (!Array.isArray(this.data[key])) {
      this.data[key] = [];
    }
    this.data[key].push(...items);
    this._onDataChange([key]);
  }

  /**
   * 替换列表型字段中指定索引的项
   * @param {string} key - 字段名
   * @param {number} index - 索引
   * @param {*} item - 新值
   */
  replaceListItem(key, index, item) {
    if (!Array.isArray(this.data[key])) return;
    if (index < 0 || index >= this.data[key].length) return;
    this.data[key][index] = item;
    this._onDataChange([key]);
  }

  /**
   * 移除列表型字段中指定索引的项
   * @param {string} key - 字段名
   * @param {number} index - 索引
   */
  removeListItem(key, index) {
    if (!Array.isArray(this.data[key])) return;
    this.data[key].splice(index, 1);
    this._onDataChange([key]);
  }

  /**
   * 数据变更回调，子类重写以触发派生重算
   * @param {string[]} keys - 变更的字段名列表
   * @protected
   */
  _onDataChange(keys) {}

  /**
   * 获取对象渲染额外留白
   * @description
   * 返回值单位为对象空间中的长度，供活动层 dirty rect 在换算到屏幕空间后补足描边、端点与抗锯齿留白。
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
   * @description
   * 有向对象可以自定义旋转中心且绕该中心旋转。
   * 无向对象的旋转中心固定在边界矩形中心。
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
   * @param {number} id - 对象 id
   * @param {Vector} position - 对象的初始位置
   * @param {Record<string, any>} [property={}] - 对象属性
   * @param {Record<string, any>} [data={}] - 对象类型专属数据
   * @constructor
   */
  constructor(id, position, property = {}, data = {}) {
    this.id = id;
    this.position = position;
    this.property = { ...this.property, ...property };
    this.data = data;
    this.rich = {};
  }

  /**
   * 设置对象的变换矩阵
   * @param {Matrix} trans - 新的变换矩阵
   * @description
   * 你应该使用此方法而不是直接修改 transform 字段。
   * 因为默认实现中，设置变换矩阵会触发边界矩形的重新计算。
   */
  setTransform(trans) {
    this.transform = trans;
    this.calculateRectangle();
  }

  /**
   * 应用变换矩阵到对象
   * @param {Matrix} trans - 要应用的变换矩阵
   * @description 将变换矩阵与当前变换矩阵相乘。
   */
  applyTransform(trans) {
    this.setTransform(this.transform.mul(trans));
  }

  /**
   * 渲染对象到画布上下文
   * @abstract
   * @param {CanvasRenderingContext2D} ctx - 画布上下文
   * @description 子类必须实现此方法以支持对象的渲染
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
      position: this.position.serialize(),
      transform: this.transform.serialize(),
      property: { ...(this.property ?? {}) },
      data: {},
    };
  }

  /**
   * 将序列化的对象转化为对象实例
   * @abstract
   * @param {object} obj - 被序列化的对象
   * @returns {BasicObject} 对象实例
   * @static
   * @description 子类必须实现此方法以支持对象的持久化
   */
  static parse(obj) {
    throw new Error("Method not implemented.");
  }
}

export { BasicObject };
