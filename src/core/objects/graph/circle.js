/**
 * @file 圆对象定义
 * @description 定义白板圆对象的几何、绘制与转换逻辑。
 * @module core/objects/graph/circle
 * @author Zhou Chenyu
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
 * @description
 * 圆是图形的一种，由中心点和半径定义。
 * @author Zhou Chenyu
 */
class CircleObject extends GraphObject {
  /**
   * 创建一个新的圆对象
   * @param {number} id - 对象 id
   * @param {Vector} position - 圆心的绝对位置
   * @param {Record<string, any>} [property={}] - 对象属性
   * @param {Record<string, any>} [data={}] - 对象类型专属数据
   * @constructor
   */
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
    this.property = { ...DEFAULT_CIRCLE_PROPERTY, ...this.property };
    if (data?.radius) {
      this.setRadius(data.radius);
    }
  }

  /**
   * 圆对象的半径
   * @type {number}
   * @description 圆的半径，属于基础数据。
   * 外界不应直接修改它，应使用 setRadius 方法。
   */
  radius = 0;

  /**
   * 设置圆的半径
   * @description 设置新的半径时，会自动更新变换后的顶点集和凸包。
   * @param {number} radius - 新的半径
   */
  setRadius(radius) {
    this.radius = radius;
    this.calculateConvexHull();
    this.calculateRectangle();
  }

  calculateRectangle() {
    this.boundingBox = RectangleRange.from(
      this.convexHullRange.transform(this.transform),
    );
  }

  /**
   * @description 在进行矩阵变换前的凸包。当且仅当 radius 发生变化时才会更新它。
   */
  calculateConvexHull() {
    this.convexHullRange = new EllipseRange(
      new Vector(0, 0),
      this.radius,
      this.radius,
    );
  }

  /**
   * @param {Matrix} trans - 新的变换矩阵
   * @description 设置变换矩阵时，它会直接修改其富数据中的顶点坐标，但不会修改基础数据。
   */
  setTransform(trans) {
    this.transform = trans;
    this.calculateRectangle();
  }

  getRange() {
    return new EllipseRange(
      new Vector(0, 0),
      this.radius,
      this.radius,
    ).transform(this.transform);
  }

  render(ctx) {
    if (this.radius <= 0) {
      return;
    }

    const strokeWidth = this.property.strokeWidth;
    const shouldFill = Boolean(this.property.fillColor);
    const shouldStroke =
      Boolean(this.property.strokeColor) &&
      Number.isFinite(strokeWidth) &&
      strokeWidth > 0;

    if (!shouldFill && !shouldStroke) {
      return;
    }

    ctx.save();
    ctx.setTransform(
      this.transform.a,
      this.transform.b,
      this.transform.c,
      this.transform.d,
      this.position.x,
      this.position.y,
    );
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);

    if (shouldFill) {
      ctx.fillStyle = this.property.fillColor;
      ctx.fill();
    }

    if (shouldStroke) {
      ctx.strokeStyle = this.property.strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }

    ctx.restore();
  }

  serialize() {
    return {
      ...super.serialize(),
      type: "CircleObject",
      data: { radius: this.radius },
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
