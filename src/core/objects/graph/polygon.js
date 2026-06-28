/**
 * @file 多边形对象定义
 * @description 定义白板多边形对象的几何、绘制与转换逻辑。
 * @module core/objects/graph/polygon
 * @author Zhou Chenyu
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
 * @description
 * 多边形是图形的一种，由多个顶点组成。
 * @author Zhou Chenyu
 */
class PolygonObject extends GraphObject {
  /**
   * 创建一个新的多边形对象
   * @param {number} id - 对象 id
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
    if (Array.isArray(data?.points)) {
      const vecs = data.points.map((p) =>
        p instanceof Vector ? p : new Vector(p.x, p.y),
      );
      this.setPolygonPoints(vecs);
    }
  }

  /**
   * 设置对象的顶点集
   * @description 设置新的顶点集时，会自动更新变换后的顶点集和凸包。
   * @param {Vector[]} points - 新的顶点集
   */
  setPolygonPoints(points) {
    this.rich.localPolygonRange = new PolygonRange(points);
    this.rich.worldPolygonRange = this.rich.localPolygonRange.transform(
      this.transform,
    );
    this.calculateConvexHull();
    this.calculateRectangle();
    this.data.points = points.map((p) => ({ x: p.x, y: p.y }));
  }

  /**
   * 修改指定索引的顶点
   * @param {number} index - 要修改的顶点索引
   * @param {Vector} points - 新的顶点坐标
   */
  replacePolygonPoint(index, points) {
    // 修改指定索引的顶点，并更新变换后的顶点集和凸包。
    if (index < 0 || index >= this.rich.localPolygonRange.points.length) {
      throw new RangeError("Index out of bounds");
    }
    const nextPoints = [...this.rich.localPolygonRange.points];
    nextPoints[index] = points;
    this.setPolygonPoints(nextPoints);
  }

  /**
   * 在末尾添加一个新的顶点
   * @param {Vector} point - 新的顶点坐标
   */
  appendPolygonPoint(point) {
    this.setPolygonPoints(this.rich.localPolygonRange.points.concat([point]));
  }

  calculateRectangle() {
    this.rich.boundingBox = RectangleRange.from(
      this.rich.convexHullRange.transform(this.transform),
    );
  }

  /**
   * @description 在进行矩阵变换前的凸包。当且仅当 points 发生变化时才会更新它。
   */
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
    this.rich.worldPolygonRange = this.rich.localPolygonRange.transform(trans);
    this.calculateRectangle();
  }

  getRange() {
    return this.rich.worldPolygonRange;
  }

  /**
   * 多边形对象的颜色
   * @type {string}
   * @default "#000000"
   */
  /**
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (
      !this.rich.localPolygonRange ||
      this.rich.localPolygonRange.points.length === 0
    ) {
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

    const points = this.rich.localPolygonRange.points;
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
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();

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
