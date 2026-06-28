/**
 * @file 笔画对象定义
 * @description 定义白板笔画对象的几何表示与渲染支持。
 * @module core/objects/stroke/stroke
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../../utils/math.js";
import { PathRange, PolygonRange, RectangleRange } from "../../range/index.js";
import { calcConvexHull, insertPoints } from "../../utils/math-algorithm.js";
import { BasicObject } from "../basic-obj.js";

const DEFAULT_STROKE_PROPERTY = Object.freeze({
  /**
   * 笔画颜色
   * @default "#000000"
   */
  color: "#000000",

  /**
   * 笔画宽度
   * @default 1
   */
  width: 1,

  /**
   * 线段连接处的样式
   * @default "round"
   */
  lineJoin: "round",

  /**
   * 线段端点的样式
   * @default "round"
   */
  lineCap: "round",
});

/**
 * 笔画类
 * @class
 * @description
 * 笔画是由一系列点组成的对象，通常用于表示手写输入的轨迹。
 * 值得一提的是，笔画是可擦除的无向对象，这与多边形对象正好相反。
 * @todo
 * 现在的这个笔画类的结构是不支持更换笔刷的。要想有这个功能，必须重构。
 * @author Zhou Chenyu
 */
class StrokeObject extends BasicObject {
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
    this.property = { ...DEFAULT_STROKE_PROPERTY, ...this.property };
    this.rich.localPathRange = new PathRange([]);
    this.rich.worldPathRange = new PathRange([]);
    this.rich.convexHullRange = new PolygonRange([]);
    this._onDataChange(Object.keys(data));
  }

  isDirected() {
    return false;
  }

  isErasable() {
    return true;
  }

  calculateRichDatas() {
    let transformedPoints = this.rich.localPathRange.points.map((p) =>
      Vector.mulMatrix(this.transform, p),
    );
    // 将其平滑（插点或删点）
    let scale = Math.sqrt(this.transform.det());
    if (scale > 1) {
      transformedPoints = insertPoints(transformedPoints, Math.round(scale));
    } else if (scale < 1) {
      // [todo] 删点
    }
    this.rich.worldPathRange = new PathRange(transformedPoints);
    this.calculateConvexHull();
    this.rich.boundingBox = RectangleRange.from(
      this.rich.convexHullRange.transform(this.transform),
    );
  }

  /**
   * 数据变更回调
   * @param {string[]} keys - 变更的字段名列表
   * @protected
   */
  _onDataChange(keys) {
    if (keys.includes('points') && Array.isArray(this.data.points)) {
      const vecs = this.data.points.map((p) => new Vector(p.x, p.y));
      this.rich.localPathRange = new PathRange(vecs);
      this.calculateRichDatas();
    }
  }



  setTransform(trans) {
    this.transform = trans;
    this.calculateRichDatas();
  }

  calculateConvexHull() {
    this.rich.convexHullRange = new PolygonRange(
      calcConvexHull(this.rich.localPathRange.points),
    );
  }

  getRange() {
    return this.rich.worldPathRange;
  }

  render(ctx) {
    if (
      !this.rich.localPathRange ||
      this.rich.localPathRange.points.length === 0
    ) {
      return;
    }

    const strokeWidth = this.property.width;
    if (!(Number.isFinite(strokeWidth) && strokeWidth > 0)) {
      return;
    }

    const transformedPoints = this.rich.worldPathRange.points;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, this.position.x, this.position.y);
    ctx.strokeStyle = this.property.color;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = this.property.lineJoin ?? DEFAULT_STROKE_PROPERTY.lineJoin;
    ctx.lineCap = this.property.lineCap ?? DEFAULT_STROKE_PROPERTY.lineCap;
    ctx.beginPath();
    ctx.moveTo(transformedPoints[0].x, transformedPoints[0].y);
    if (transformedPoints.length === 1) {
      ctx.arc(0, 0, strokeWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = this.property.color;
      ctx.fill();
    } else {
      for (let i = 1; i < transformedPoints.length; i++) {
        ctx.lineTo(transformedPoints[i].x, transformedPoints[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  serialize() {
    return {
      ...super.serialize(),
      type: "StrokeObject",
      data: { ...this.data },
    };
  }

  static parse(serialized) {
    if (serialized.type !== "StrokeObject") {
      throw new TypeError("Invalid type for StrokeObject parsing");
    }

    const obj = new StrokeObject(
      serialized.id,
      Vector.parse(serialized.position),
      { ...DEFAULT_STROKE_PROPERTY, ...(serialized.property ?? {}) },
      serialized.data ?? {},
    );

    obj.setTransform(Matrix.parse(serialized.transform));
    return obj;
  }
}

export { DEFAULT_STROKE_PROPERTY, StrokeObject };
