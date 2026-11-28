/**
 * @file 多边形对象定义
 * @description 定义白板多边形对象的几何、绘制与转换逻辑。
 * @module kernel/objects/graph/polygon
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { GraphObject } from "./graph.js";
import { Matrix, Vector } from "../../utils/math.js";
import { calcConvexHull } from "../../utils/math-algorithm.js";
import { PolygonRange, RectangleRange } from "../../range/index.js";

const DEFAULT_POLYGON_PROPERTY = Object.freeze({
  fillColor: "#000000",
  strokeColor: null,
  strokeWidth: 0,
});

/**
 * 多边形类
 * @class
 * @extends GraphObject
 * @author Zhou Chenyu
 */
class PolygonObject extends GraphObject {
  /**
   * 创建一个新的多边形对象
   * @param {string} id - 对象 id
   * @param {Vector} position - 多边形逻辑左上角的绝对位置
   * @param {Record<string, any>} [property={}] - 对象属性
   * @param {Record<string, any>} [data={}] - 对象类型专属数据
   * @constructor
   */
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
    this.property = { ...DEFAULT_POLYGON_PROPERTY, ...this.property };
    this.rich.localPolygonRange = new PolygonRange([]);
    this.rich.worldPolygonRange = new PolygonRange([]);
    this.rich.convexHullRange = new PolygonRange([]);
    this._onDataChange(Object.keys(data));
  }

  _onDataChange(keys) {
    if (keys.includes("points") && Array.isArray(this.data.points)) {
      const vecs = this.data.points.map((p) => new Vector(p.x, p.y));
      this.rich.localPolygonRange = new PolygonRange(vecs);
      this.rich.worldPolygonRange = PolygonObject.createWorldRange(this.data, this.transform);
      this.calculateConvexHull();
      this.calculateRectangle();
    }
  }

  calculateRectangle() {
    if (
      !this.rich.convexHullRange ||
      this.rich.convexHullRange.points.length === 0
    ) {
      this.rich.boundingBox = new RectangleRange(0, 0, 0, 0);
      return;
    }
    this.rich.boundingBox = RectangleRange.from(
      this.rich.convexHullRange.transform(this.transform),
    );
  }

  calculateConvexHull() {
    this.rich.convexHullRange = new PolygonRange(
      calcConvexHull(this.rich.localPolygonRange.points),
    );
  }

  /**
   * @param {Matrix} trans - 新的变换矩阵
   * @description 设置变换矩阵时，它会直接修改其富数据中的顶点坐标，但不会修改基础数据。
   */
  setTransform(trans) {
    this.transform = trans;
    this.rich.worldPolygonRange = PolygonObject.createWorldRange(this.data, trans);
    this.calculateRectangle();
  }

  /**
   * 从原始点列构造世界多边形范围
   * @param {Record<string, any>} data - 点列数据
   * @param {Matrix} transform - 变换矩阵
   * @returns {PolygonRange} 世界多边形范围
   */
  static createWorldRange(data, transform) {
    const points = (data.points ?? []).map((point) => new Vector(point.x, point.y));
    return new PolygonRange(points).transform(transform);
  }

  /**
   * 从序列化快照构造世界多边形范围
   * @param {Object} serialized - 序列化快照
   * @returns {PolygonRange} 世界多边形范围
   */
  static rangeFromSerialized(serialized) {
    return PolygonObject.createWorldRange(serialized.data ?? {}, Matrix.parse(serialized.transform));
  }

  getRange() {
    return this.rich.worldPolygonRange;
  }

  serialize() {
    return {
      ...super.serialize(),
      type: "PolygonObject",
      data: { ...this.data },
    };
  }

  static parse(serialized) {
    if (serialized.type !== "PolygonObject") {
      throw new TypeError("Invalid type for PolygonObject parsing");
    }
    let obj = new PolygonObject(
      serialized.id,
      Vector.parse(serialized.position),
      { ...DEFAULT_POLYGON_PROPERTY, ...(serialized.property ?? {}) },
      serialized.data ?? {},
    );
    obj.setTransform(Matrix.parse(serialized.transform));
    return obj;
  }
}

export { DEFAULT_POLYGON_PROPERTY, PolygonObject };
