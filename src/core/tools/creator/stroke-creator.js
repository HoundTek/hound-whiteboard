/**
 * @file 笔画创建工具
 * @description 提供用于绘制笔画对象的创建器工具实现。
 * @module core/tools/creator/stroke-creator
 * @author Zhou Chenyu
 */

import {
  DEFAULT_STROKE_PROPERTY,
  StrokeObject,
} from "../../objects/stroke/stroke.js";
import { SingleGestureObjectCreatorTool } from "./obj-creator.js";
import { Vector } from "../../utils/math.js";

/**
 * 笔画创建工具类
 * @class
 * @extends SingleGestureObjectCreatorTool
 * @description
 * 单手势创建笔画对象：
 * - 手势开始点为笔画起点
 * - 手势结束点为笔画终点
 * - 手势路径为笔画路径
 * @author Zhou Chenyu
 */
class StrokeCreatorTool extends SingleGestureObjectCreatorTool {
  /**
   * 当前正在创建的笔画对象
   * @type {StrokeObject}
   */
  obj;

  /**
   * 笔画对象的属性
   * @type {Record<string, any>}
   */
  property;

  /**
   * @param {{
   *   property?: Partial<typeof DEFAULT_STROKE_PROPERTY>,
   * }} [options={}]
   * @constructor
   */
  constructor(options = {}) {
    super(options);
    this.property = {
      ...DEFAULT_STROKE_PROPERTY,
      ...(options.property ?? {}),
    };
  }

  create(p, id) {
    this.obj = new StrokeObject(id, p);
    this.obj.setProperty(this.property);
  }

  /**
   * 将世界坐标转换为对象局部坐标
   * @param {Vector} position
   * @returns {Vector}
   */
  toLocalPoint(position) {
    return position.sub(this.obj.position);
  }

  appendPathPoint(point) {
    const points = this.obj.localPathRange.points;
    const lastPoint = points[points.length - 1];
    if (lastPoint && Vector.nearlyEq(lastPoint, point)) {
      return;
    }
    this.obj.setPathPoints(points.concat([point]));
  }

  beginCreationGesture(interaction) {
    this.appendPathPoint(this.toLocalPoint(interaction.position));
  }

  updateCreationGesture(interaction) {
    this.appendPathPoint(this.toLocalPoint(interaction.position));
  }

  completeCreationGesture(interaction) {
    if (interaction.position) {
      this.appendPathPoint(this.toLocalPoint(interaction.position));
    }
  }

  reset() {
    this.obj = null;
  }
}

export { StrokeCreatorTool };
