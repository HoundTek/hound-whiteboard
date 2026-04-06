/**
 * 对象创建工具
 * @module core/tools/creator/obj-creator
 * @author Zhou Chenyu
 */

import { Point } from "../../../utils/math.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { Controller } from "../controller/controller.js";
import { Tool } from "../tool.js";

/**
 * 对象创建工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 对象创建工具是用于在白板上创建各种对象的工具的基类。
 * 具体的对象创建工具应继承此类并实现其特定功能。
 * 例如，矩形创建工具用于创建矩形对象，圆形创建工具用于创建圆形对象等。
 * 这些工具通常允许用户通过点击和拖动来定义对象的位置和大小。
 * @author Zhou Chenyu
 */
class ObjectCreatorTool extends Tool {
  /**
   * @constructor
   */
  constructor() {
    super();
  }

  /**
   * 解析序列化的对象生成工具数据以创建工具实例
   * @static
   * @abstract
   * @param {Object} toolData - 序列化的工具数据
   * @returns {ObjectCreatorTool} 创建的对象生成工具实例
   */
  static parse(toolData) {
    throw new Error("Method not implemented.");
  }

  /**
   * 序列化对象生成工具实例以保存工具数据
   * @abstract
   * @return {Object} 序列化后的对象生成工具数据
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 当前正在创建的对象
   * @type {BasicObject}
   */
  obj;

  /**
   * @returns {Controller[]} 控制点列表
   */
  getControllers() {
    throw new Error("Method not implemented.");
  }

  /**
   * 创建新的对象实例
   * @param {Point} position - 新对象的位置
   * @param {number} id - 新对象的 id
   * @param {number} pageId - 新对象所在的页 id
   * @description 在用户使用该工具创建新对象（而不是编辑正在创建的对象）时调用此方法以生成新的对象实例
   * @abstract
   */
  create(position, id, pageId) {
    throw new Error("Method not implemented.");
  }
}

export {
  ObjectCreatorTool,
};
