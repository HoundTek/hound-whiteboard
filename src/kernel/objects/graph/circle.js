/**
 * @file 圆对象定义
 * @description 定义白板圆对象的几何、绘制与转换逻辑。
 * @module kernel/objects/graph/circle
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { GraphObject } from "./graph.js";
import { Matrix, Vector } from "../../utils/math.js";
import { EllipseRange, RectangleRange } from "../../range/index.js";

const DEFAULT_CIRCLE_PROPERTY = Object.freeze({
  fillColor: null,
  strokeColor: "#000000",
  strokeWidth: 3,
});

/**
 * 圆类
 * @class
 * @extends GraphObject
 * @author Zhou Chenyu
 */
class CircleObject extends GraphObject {
  /**
   * 创建一个新的圆对象
   * @param {string} id - 对象 id
   * @param {Vector} position - 圆心的绝对位置
   * @param {Record<string, any>} [property={}] - 对象属性
   * @param {Record<string, any>} [data={}] - 对象类型专属数据
   * @constructor
   */
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
    this.property = { ...DEFAULT_CIRCLE_PROPERTY, ...this.property };
    this.rich.convexHullRange = new EllipseRange(new Vector(0, 0), 0, 0);
    this._onDataChange(Object.keys(data));
  }

  _onDataChange(keys) {
    if (keys.includes("radius") && this.data.radius != null) {
      this.rich.convexHullRange = new EllipseRange(
        new Vector(0, 0),
        this.data.radius,
        this.data.radius,
      );
      this.rich.boundingBox = RectangleRange.from(
        this.rich.convexHullRange.transform(this.transform),
      );
    }
  }

  calculateRectangle() {
    this.rich.boundingBox = RectangleRange.from(
      this.rich.convexHullRange.transform(this.transform),
    );
  }

  calculateConvexHull() {
    this.rich.convexHullRange = new EllipseRange(
      new Vector(0, 0),
      this.data.radius,
      this.data.radius,
    );
  }

  /**
   * 从原始数据构造世界范围
   * @param {Record<string, any>} data - 半径数据
   * @param {Matrix} transform - 变换矩阵
   * @returns {EllipseRange} 世界范围
   */
  static createRange(data, transform) {
    const radius = data.radius ?? 0;
    return new EllipseRange(new Vector(0, 0), radius, radius).transform(transform);
  }

  /**
   * 从序列化快照构造世界范围
   * @param {Object} serialized - 序列化快照
   * @returns {EllipseRange} 世界范围
   */
  static rangeFromSerialized(serialized) {
    return CircleObject.createRange(serialized.data ?? {}, Matrix.parse(serialized.transform));
  }

  getRange() {
    return CircleObject.createRange(this.data, this.transform);
  }

  serialize() {
    return {
      ...super.serialize(),
      type: "CircleObject",
      data: { ...this.data },
    };
  }

  static parse(serialized) {
    if (serialized.type !== "CircleObject") {
      throw new TypeError("Invalid type for CircleObject parsing");
    }
    let obj = new CircleObject(
      serialized.id,
      Vector.parse(serialized.position),
      { ...DEFAULT_CIRCLE_PROPERTY, ...(serialized.property ?? {}) },
      serialized.data ?? {},
    );
    obj.setTransform(Matrix.parse(serialized.transform));
    return obj;
  }
}

export { CircleObject, DEFAULT_CIRCLE_PROPERTY };
