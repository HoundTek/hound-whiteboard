/**
 * 多边形创建工具
 * @module core/tools/creator/polygon
 * @author Zhou Chenyu
 */

import { PolygonObject } from "../../objects/graph/polygon.js";
import { Vector } from "../../../utils/math.js";
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
   * @type {Vector}
   */
  lastPoint;

  getControllers() {
    return this.vertixControllers;
  }

  /**
   * @param {Vector} position - 对象位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 页 id
   */
  create(position, id, pageId) {
    this.obj = new PolygonObject(position, id, pageId);
  }

  /**
   * @description 创建手势开始时，添加一个新的顶点。
   * @param {Object} interaction - 当前交互上下文
   */
  beginObjectCreation(interaction) {
    this.obj.appendPoint(interaction.position);
    this.lastPoint = interaction.position;
    this.count++;
  }

  /**
   * @description 创建手势更新时，修改当前顶点位置。
   * @param {Object} interaction - 当前交互上下文
   */
  updateObjectCreation(interaction) {
    if (!Vector.nearlyEq(this.lastPoint, interaction.position)) {
      this.lastPoint = interaction.position;
      this.obj.changePoint(this.count - 1, interaction.position);
    }
  }

  /**
   * @description 创建手势结束时，固定当前顶点并追加控制点。
   * @param {Object} interaction - 当前交互上下文
   */
  completeObjectCreation(interaction) {
    if (
      interaction.position &&
      !Vector.nearlyEq(this.lastPoint, interaction.position)
    ) {
      this.lastPoint = interaction.position;
      this.obj.changePoint(this.count - 1, interaction.position);
    }
    const controller = new VertexController(this.lastPoint);
    controller.onDrag = (newPosition) => {
      this.obj.changePoint(this.count - 1, newPosition);
    };
    this.vertixControllers.push(controller);
  }

  reset() {
    this.obj = null;
    this.vertixControllers = [];
    this.count = 0;
    this.lastPoint = null;
  }
}

export {
  PolygonCreatorTool,
};
