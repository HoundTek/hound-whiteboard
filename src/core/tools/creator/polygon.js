/**
 * 多边形创建工具
 * @module core/tools/creator/polygon
 * @author Zhou Chenyu
 */

import { PolygonObject } from "../../objects/graph/polygon.js";
import { Point } from "../../../utils/math.js";
import { ObjectCreatorTool } from "./obj-creator.js";
import { Controller } from "../controller/controller.js";
import { VertexController } from "../controller/vertex-controller.js";

/**
 * 多边形创建工具类
 * @class
 * @extends ObjectCreatorTool
 * @description
 * 多边形创建工具允许用户在白板上绘制多边形对象。
 *
 * 用户可以通过点击来添加多边形的顶点，形成所需的形状。
 * 或者拖动操作杆来调整顶点位置以修改多边形的形状。
 *
 * 当用户完成绘制后，可以通过点击菜单中的完成按钮来结束绘制过程。（todo）
 * @author Zhou Chenyu
 */
class PolygonCreatorTool extends ObjectCreatorTool {
  /**
   * @constructor
   */
  constructor() {
    super();
    this.vertixControllers = [];
    this.count = 0;
    this.lastPoint = null;
  }

  /**
   * 解析序列化的多边形工具数据以创建工具实例
   * @static
   * @param {Object} toolData - 序列化的多边形工具数据
   * @returns {PolygonCreatorTool} 创建的多边形工具实例
   * @todo
   */
  static parse(toolData) {
    let tool = new PolygonCreatorTool();
    if (!toolData || toolData.type !== "PolygonTool")
      throw new Error("Invalid tool data for PolygonTool.");
    tool.obj = toolData.obj ? PolygonObject.parse(toolData.obj) : null;
    return tool;
  }

  /**
   * 序列化多边形工具实例以保存工具数据
   * @return {Object} 序列化后的多边形工具数据
   * @todo
   */
  serialize() {
    return {
      type: "PolygonTool",
      obj: this.obj?.serialize(),
    };
  }

  /**
   * @type {PolygonObject}
   * @description 当前正在绘制的多边形对象
   */
  obj;

  /**
   * 当前对象的控制点
   * @type {Controller[]}
   */
  vertixControllers;

  /**
   * 当前顶点数量
   * @type {number}
   */
  count;

  /**
   * 上一个顶点位置
   * @type {Point}
   */
  lastPoint;

  getControllers() {
    return this.vertixControllers;
  }

  /**
   * @param {Point} position - 对象位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 页 id
   */
  create(position, id, pageId) {
    this.obj = new PolygonObject(position, id, pageId);
  }

  /**
   * @description 用户按下设备时，添加一个新的顶点，并新增一个控制点。
   * @param {Point} point - 用户按下设备时的位置
   * @param {Object} option - 选项
   */
  start(point, option) {
    this.obj.appendPoint(point);
    this.lastPoint = point;
    this.count++;
  }

  /**
   * @description 用户移动设备时，更新当前顶点位置和控制点位置。
   * 如果当前位置与当前顶点位置相同，则不进行任何操作。
   * @param {Point} point - 用户松开设备时的位置
   * @param {Object} option - 选项
   */
  move(point, option) {
    if (!Point.nearlyEq(this.lastPoint, point)) {
      this.lastPoint = point;
      this.obj.changePoint(this.count - 1, point);
    }
  }

  /**
   * @description 用户松开设备时，当前顶点的位置就被确定下来了。
   * 如果当前位置与当前顶点位置相同，则不进行任何操作。
   * @param {Point} point - 用户松开设备时的位置
   * @param {Object} option - 选项
   */
  end(point, option) {
    if (!Point.nearlyEq(this.lastPoint, point)) {
      this.lastPoint = point;
      this.obj.changePoint(this.count - 1, point);
    }
    let controller = new VertexController(point);
    controller.onDrag = (newPosition) => {
      this.obj.changePoint(this.count - 1, newPosition);
    };
    this.vertixControllers.push(controller);
  }
}

export {
  PolygonCreatorTool,
};
