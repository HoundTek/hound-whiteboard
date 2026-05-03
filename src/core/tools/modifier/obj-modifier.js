/**
 * 对象修改工具
 * @module core/tools/modifier/obj-modifier
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";

/**
 * 对象修改工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 对象修改工具负责改变已有对象的几何形态、样式或其它可编辑属性。
 */
class ObjectModifierTool extends Tool {
  /**
   * 对对象应用变更。
   * @param {Object} modificationContext - 修改上下文
   * @returns {*}
   */
  modify(modificationContext) {
    throw new Error("Method not implemented.");
  }
}

export {
  ObjectModifierTool,
};
