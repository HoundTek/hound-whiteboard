/**
 * @file 多边形对象定义
 * @module board/graph/polygon
 * @author Zhou Chenyu
 */

const { Quark, PolygonQuark } = require("../../quarks");
const { GraphObject } = require("./graph");
const { Matrix, Point } = require("../../../../utils/math");

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
    super(p, id, pageId, false, true);
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
    this.#transformedPoints = points.map((p) =>
      Point.mulMatrix(this.transform, p)
    );
    this.calculateConvexHull();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let p of this.#transformedPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    this.rectangle = new Matrix(minX, minY, maxX, maxY);
  }

  /**
   * @description 使用 Graham 扫描算法计算凸包。
   */
  calculateConvexHull() {
    if (!this.points || this.points.length < 3) {
      this.convexHull = this.points ? [...this.points] : [];
      return;
    }

    let points = [...this.points];
    points.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    function cross(o, a, b) {
      return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    const lower = [];
    for (let p of points) {
      while (
        lower.length >= 2 &&
        cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
      ) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper = [];
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      while (
        upper.length >= 2 &&
        cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
      ) {
        upper.pop();
      }
      upper.push(p);
    }

    // 移除每一半的最后一个点，因为它在另一半的开头被重复了
    upper.pop();
    lower.pop();

    this.convexHull = lower.concat(upper);
  }

  /**
   * 多边形对象经变换的顶点
   * @type {Point[]}
   * @description 每一个点在变换后，相对 position 的位置数组，属于富数据。
   */
  #transformedPoints = [];

  /**
   * @param {Matrix} trans - 新的变换矩阵
   * @description 设置变换矩阵时，它会直接修改其富数据中的顶点坐标，但不会修改基础数据。
   */
  setTransform(trans) {
    this.transform = trans;
    this.#transformedPoints = this.points.map((p) => Point.mulMatrix(trans, p));
  }

  get transformedPoints() {
    return this.#transformedPoints;
  }

  /**
   * 多边形对象的颜色
   * @type {string}
   * @default "#000000"
   */
  color = "#000000";

  /**
   * @returns {Quark[]}
   */
  getQuarks() {
    let quark = new PolygonQuark(this.position, this.#transformedPoints);
    quark.color = this.color;
    return [quark];
  }

  /**
   * @description 使用绳钉法判断点是否在多边形内
   * @returns {boolean} 点是否在多边形内
   */
  isPointIntersect(p) {
    // 先用矩形框进行初步检测
    if (!super.isPointIntersect(p)) {
      return false;
    }

    let counter = 0;
    for (let i = 0; i < this.#transformedPoints.length; i++) {
      let first = this.#transformedPoints[i];
      let second =
        this.#transformedPoints[(i + 1) % this.#transformedPoints.length];
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
      if (p.y < ly) {
        if (first.x <= second.x) {
          counter++;
        } else {
          counter--;
        }
      } else if (p.y == ly) {
        return true; // 在边上
      }
    }
    return counter != 0;
  }
}

module.exports = {
  PolygonObject,
};
