/**
 * @file 笔画对象定义
 * @module core/objects/stroke/stroke
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../../utils/math.js";
import { PathRange, PolygonRange, RectangleRange } from "../../range/index.js";
import { calcConvexHull, insertPoints } from "../../utils/math-algorithm.js";
import { BasicObject } from "../basic-obj.js";

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
  constructor(p, id, ownerPageId) {
    super(p, id, ownerPageId);
  }

  static isDirected = false;

  static isErasable = true;

  /**
   * 内点曲线
   * @type {PathRange}
   * @description
   * 笔画的内点曲线。笔画沿着这些点绘制。
   *
   * 内点是用来判断笔画位置的。
   */
  localPathRange = new PathRange([]);

  /**
   * 平滑和变换后的内点曲线
   * @type {PathRange}
   * @description
   * 经过平滑和变换后的路径范围。这个属性是根据原始局部路径通过应用当前的变换矩阵计算得出的。
   *
   * 这个属性主要用于渲染和碰撞检测等需要考虑对象变换的场景。它反映了笔画在当前变换状态下的实际位置和形状。
   * 当笔画的变换发生变化时（例如缩放、旋转或平移），worldPathRange 会自动更新以反映新的位置和形状。
   *
   * 需要注意的是，worldPathRange 是一个计算属性，通常不应直接修改它，而是通过修改 localPathRange 和变换矩阵来间接更新它。
   * 这样可以确保数据的一致性和正确性。
   * 在渲染笔画时，系统会使用 worldPathRange 来绘制笔画路径，从而实现正确的视觉效果。
   * 在碰撞检测时，系统也会使用 worldPathRange 来判断笔画与其他对象之间的交互。
   */
  worldPathRange = new PathRange([]);

  calculateRichDatas() {
    let transformedPoints = this.localPathRange.points.map((p) =>
      Vector.mulMatrix(this.transform, p),
    );
    // 将其平滑（插点或删点）
    let scale = Math.sqrt(this.transform.det());
    if (scale > 1) {
      transformedPoints = insertPoints(transformedPoints, Math.round(scale));
    } else if (scale < 1) {
      // [todo] 删点
    }
    this.worldPathRange = new PathRange(transformedPoints);
    this.calculateConvexHull();
    this.boundingBox = RectangleRange.from(
      this.convexHullRange.transform(this.transform),
    );
  }

  setPathPoints(points) {
    this.localPathRange = new PathRange(points);
    this.calculateRichDatas();
  }

  setTransform(trans) {
    this.transform = trans;
    this.calculateRichDatas();
  }

  convexHullRange = new PolygonRange([]);

  calculateConvexHull() {
    this.convexHullRange = new PolygonRange(
      calcConvexHull(this.localPathRange.points),
    );
  }

  getRange() {
    return this.worldPathRange;
  }

  /**
   * 笔画对象的颜色
   * @type {string}
   * @description
   * 笔画的颜色，默认为黑色。
   * 笔画的颜色属性主要用于渲染和擦除时的视觉效果。
   * 当用户选择不同颜色的笔刷时，这个属性会被更新，以反映当前笔刷的颜色。
   * 在渲染笔画时，系统会使用这个颜色属性来绘制笔画的外点，从而实现不同颜色的笔画效果。
   * 在擦除笔画时，系统可能会根据这个颜色属性来决定如何处理被擦除部分的视觉效果，例如是否显示擦除痕迹等。
   * 需要注意的是，虽然笔画对象具有颜色属性，但在某些情况下（例如使用特殊的笔刷或工具时），这个属性可能会被忽略或覆盖。
   */
  color = "#000000";

  render(ctx) {
    if (!this.localPathRange || this.localPathRange.points.length === 0) {
      return;
    }
    const transformedPoints = this.worldPathRange.points;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, this.position.x, this.position.y);
    ctx.strokeStyle = this.color;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(transformedPoints[0].x, transformedPoints[0].y);
    for (let i = 1; i < transformedPoints.length; i++) {
      ctx.lineTo(transformedPoints[i].x, transformedPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  serialize() {
    return {
      ...super.serialize(),
      type: "StrokeObject",
      points: this.localPathRange.points.map((point) => point.serialize()),
      color: this.color,
    };
  }

  static parse(data) {
    if (data.type !== "StrokeObject") {
      throw new TypeError("Invalid type for StrokeObject parsing");
    }

    const obj = new StrokeObject(
      Vector.parse(data.position),
      data.id,
      data.ownerPageId,
    );

    obj.setPathPoints((data.points ?? []).map((point) => Vector.parse(point)));
    obj.setTransform(Matrix.parse(data.transform));
    obj.color = data.color ?? obj.color;
    return obj;
  }
}

export { StrokeObject };
