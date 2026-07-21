/**
 * @file 椭圆对象定义
 * @description 定义白板椭圆对象的几何、绘制与转换逻辑。
 * @module core/engine/objects/graph/ellipse
 * @author Zhou Chenyu
 */

import { GraphObject } from "./graph.js";
import { Matrix, Vector } from "../../utils/math.js";
import { EllipseRange, RectangleRange } from "../../range/index.js";

const DEFAULT_ELLIPSE_PROPERTY = Object.freeze({
  fillColor: null,
  strokeColor: "#000000",
  strokeWidth: 3,
});

/**
 * 椭圆类
 * @class
 * @extends GraphObject
 * @description
 * 以双轴半径为专属数据的椭圆对象：`data.radiusX` / `data.radiusY` 为对象空间
 * 两轴半径，`position` 为椭圆中心的世界坐标。非轴对齐或额外缩放经
 * `transform` 表达，与 circle 的 transform 语义一致。
 * @author Zhou Chenyu
 */
class EllipseObject extends GraphObject {
  /**
   * 创建一个新的椭圆对象
   * @param {number} id - 对象 id
   * @param {Vector} position - 椭圆中心的绝对位置
   * @param {Record<string, any>} [property={}] - 对象属性
   * @param {Record<string, any>} [data={}] - 对象类型专属数据（radiusX / radiusY）
   * @constructor
   */
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
    this.property = { ...DEFAULT_ELLIPSE_PROPERTY, ...this.property };
    this.rich.convexHullRange = new EllipseRange(new Vector(0, 0), 0, 0);
    this._onDataChange(Object.keys(data));
  }

  _onDataChange(keys) {
    const hasRadiusX = keys.includes("radiusX") && this.data.radiusX != null;
    const hasRadiusY = keys.includes("radiusY") && this.data.radiusY != null;
    if (hasRadiusX || hasRadiusY) {
      this.rich.convexHullRange = new EllipseRange(
        new Vector(0, 0),
        this.data.radiusX ?? 0,
        this.data.radiusY ?? 0,
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
      this.data.radiusX ?? 0,
      this.data.radiusY ?? 0,
    );
  }

  getRange() {
    return new EllipseRange(
      new Vector(0, 0),
      this.data.radiusX ?? 0,
      this.data.radiusY ?? 0,
    ).transform(this.transform);
  }

  render(ctx) {
    if (!(this.data.radiusX > 0) || !(this.data.radiusY > 0)) {
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
    ctx.ellipse(0, 0, this.data.radiusX, this.data.radiusY, 0, 0, Math.PI * 2);

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
      type: "EllipseObject",
      data: { ...this.data },
    };
  }

  static parse(serialized) {
    if (serialized.type !== "EllipseObject") {
      throw new TypeError("Invalid type for EllipseObject parsing");
    }
    let obj = new EllipseObject(
      serialized.id,
      Vector.parse(serialized.position),
      { ...DEFAULT_ELLIPSE_PROPERTY, ...(serialized.property ?? {}) },
      serialized.data ?? {},
    );
    obj.setTransform(Matrix.parse(serialized.transform));
    return obj;
  }
}

export { EllipseObject, DEFAULT_ELLIPSE_PROPERTY };
