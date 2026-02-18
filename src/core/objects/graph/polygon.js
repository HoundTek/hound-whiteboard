/**
 * @file 多边形对象定义
 * @module board/graph/polygon
 * @author Zhou Chenyu
 */

const { GraphObject } = require("./graph");
const { Matrix, Point } = require("../../../utils/math");
const { calculateConvexHull } = require("../../utils/math-algorithm");

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
   * @param {Point} p - 多边形逻辑左上角的绝对位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 对象所在页的 id
   * @param {Point[]} points - 多边形各顶点相对其左上角的相对位置
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
   * @type {Point[]}
   * @description
   * 每一个点在变换前，相对 position 的位置数组，属于基础数据。
   * 外界不应直接修改它，应使用 setPoints 方法。
   */
  points = [];

  /**
   * 设置对象的顶点集
   * @description 设置新的顶点集时，会自动更新变换后的顶点集和凸包。
   * @param {Point[]} points - 新的顶点集
   */
  setPoints(points) {
    this.points = points;
    this.transformedPoints = points.map((p) =>
      Point.mulMatrix(this.transform, p)
    );
    this.calculateConvexHull();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let p of this.transformedPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    this.rectangle = new Matrix(minX, minY, maxX, maxY);
  }

  /**
   * @description 在进行矩阵变换前的凸包。当且仅当 points 发生变化时才会更新它。为富数据。
   */
  calculateConvexHull() {
    this.convexHull = calculateConvexHull(this.points);
  }

  /**
   * 多边形对象经变换的顶点
   * @type {Point[]}
   * @description 每一个点在变换后，相对 position 的位置数组，属于富数据。
   */
  transformedPoints = [];

  /**
   * @param {Matrix} trans - 新的变换矩阵
   * @description 设置变换矩阵时，它会直接修改其富数据中的顶点坐标，但不会修改基础数据。
   */
  setTransform(trans) {
    this.transform = trans;
    this.transformedPoints = this.points.map((p) => Point.mulMatrix(trans, p));
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
      this.position.y
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
   * @param {Point} p - 要检测的点
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

    let counter = 0;
    for (let i = 0; i < this.transformedPoints.length; i++) {
      let first = this.transformedPoints[i];
      let second =
        this.transformedPoints[(i + 1) % this.transformedPoints.length];
      if (first.x < second.x) {
        if (p.x < first.x || second.x < p.x) {
          continue;
        }
      } else {
        if (p.x < second.x || first.x < p.x) {
          continue;
        }
      }

      if (first.x == p.x && first.y == p.y) {
        return true; // 在顶点上
      }

      let k = (second.y - first.y) / (second.x - first.x);
      let ly = first.y + k * (p.x - first.x);
      if (p.y > ly) {
        if (first.x <= second.x) {
          counter++;
        } else {
          counter--;
        }
      } else if (p.y >= ly - 1e-5) {
        return true; // 在边上（允许一定误差）
      }
    }
    return counter != 0;
  }
}

module.exports = {
  PolygonObject,
};
