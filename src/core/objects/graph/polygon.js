/**
 * @file 多边形对象定义
 * @module board/graph/polygon
 * @author Zhou Chenyu
 */

import { GraphObject } from "./graph.js";
import { Matrix, Vector } from "../../../utils/math.js";
import {
  calculateConvexHull,
  ropeNailIntersect,
} from "../../utils/math-algorithm.js";
import { RectangleRange } from "../../range/rectangle.js";

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
   * @param {Vector} p - 多边形逻辑左上角的绝对位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 对象所在页的 id
   * @param {Vector[]} points - 多边形各顶点相对其左上角的相对位置
   * @constructor
   */
  constructor(p, id, pageId, points) {
    super(p, id, pageId);
    if (points) {
      this.setPoints(points);
    }
  }

  /**
   * 多边形对象的顶点集
   * @type {Vector[]}
   * @description
   * 每一个点在变换前，相对 position 的位置数组，属于基础数据。
   * 外界不应直接修改它，应使用 setPoints 方法。
   */
  points = [];

  /**
   * 设置对象的顶点集
   * @description 设置新的顶点集时，会自动更新变换后的顶点集和凸包。
   * @param {Vector[]} points - 新的顶点集
   */
  setPoints(points) {
    this.points = points;
    this.transformedPoints = points.map((p) =>
      Vector.mulMatrix(this.transform, p),
    );
    this.calculateConvexHull();
    this.calculateRectangle();
  }

  /**
   * 修改指定索引的顶点
   * @param {number} index - 要修改的顶点索引
   * @param {Vector} points - 新的顶点坐标
   */
  changePoint(index, points) {
    // 修改指定索引的顶点，并更新变换后的顶点集和凸包。
    if (index < 0 || index >= this.points.length) {
      throw new RangeError("Index out of bounds");
    }
    this.points[index] = points;
    this.transformedPoints[index] = Vector.mulMatrix(this.transform, points);
    this.calculateConvexHull();
    this.calculateRectangle();
  }

  /**
   * 在末尾添加一个新的顶点
   * @param {Vector} point - 新的顶点坐标
   */
  appendPoint(point) {
    // 在末尾添加一个新的顶点，并更新变换后的顶点集和凸包。
    this.points.push(point);
    this.transformedPoints.push(Vector.mulMatrix(this.transform, point));
    this.calculateConvexHull();
    this.calculateRectangle();
  }

  /**
   * @description 计算多边形对象的矩形范围。是在凸包的基础上进行计算的变换后的矩形范围。
   */
  calculateRectangle() {
    this.rectangle = RectangleRange.calculate(this.convexHull).mulMatrix(
      this.transform,
    );
  }

  /**
   * @description 在进行矩阵变换前的凸包。当且仅当 points 发生变化时才会更新它。
   */
  calculateConvexHull() {
    this.convexHull = calculateConvexHull(this.points);
  }

  /**
   * 多边形对象经变换的顶点
   * @type {Vector[]}
   * @description 每一个点在变换后，相对 position 的位置数组，属于富数据。
   */
  transformedPoints = [];

  /**
   * @param {Matrix} trans - 新的变换矩阵
   * @description 设置变换矩阵时，它会直接修改其富数据中的顶点坐标，但不会修改基础数据。
   */
  setTransform(trans) {
    this.transform = trans;
    this.transformedPoints = this.points.map((p) => Vector.mulMatrix(trans, p));
    this.calculateRectangle();
  }

  /**
   * 多边形对象的颜色
   * @type {string}
   * @default "#000000"
   */
  color = "#000000";

  /**
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.points || this.points.length === 0) {
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
    ctx.fillStyle = this.color;
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * @param {Vector} p - 要检测的点
   * @description 判断原则：若将该多边形用 canvas 绘制出来，点 p 是否会落在填充区域内或边界上。
   * @returns {boolean} 点是否在多边形内
   */
  isPointIntersect(p) {
    // 先用矩形框进行初步检测
    if (!super.isPointIntersect(p)) {
      return false;
    }

    // 将点转换到多边形的局部坐标系中（减掉相对位置）
    p = p.sub(this.position);

    // 再用绳钉算法进行精确检测
    return ropeNailIntersect(this.transformedPoints, p) !== 0;
  }

  serialize() {
    return {
      ...super.serialize(),
      type: "PolygonObject",
      points: this.points.map(p => p.serialize()),
      color: this.color,
    };
  }

  static parse(data) {
    if (data.type !== "PolygonObject") {
      throw new TypeError("Invalid type for PolygonObject parsing");
    }
    let obj = new PolygonObject(
      Vector.parse(data.position),
      data.id,
      data.pageId,
      data.points.map((p) => Vector.parse(p)),
    );
    obj.setTransform(Matrix.parse(data.transform));
    obj.color = data.color;
    return obj;
  }
}

export {
  PolygonObject,
};
