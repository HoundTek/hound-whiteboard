/**
 * 工具基类
 * @module core/tools/tool
 * @author Zhou Chenyu
 */

/**
 * 工具基类
 *
 * @class
 * @abstract
 * @description
 * 工具是设备与白板交互的媒介，不同的工具有不同的交互方式。
 * 例如，画笔工具允许用户绘制图形，而选择工具允许用户选择和操作已有对象。
 *
 * 工具类定义了所有工具的基本属性和方法，具体工具应继承此类并实现其特定功能。
 * @author Zhou Chenyu
 */
class Tool {
  /**
   * @constructor
   */
  constructor() {}

  /**
   * 解析序列化的工具数据以创建工具实例
   * @returns {Tool} 创建的工具实例
   * @throws {Error} 基类未实现此方法
   * @static
   * @abstract
   */
  static parse() {
    throw new Error("Method not implemented.");
  }

  /**
   * 序列化工具实例以保存工具数据
   * @return {Object} 序列化后的工具数据
   * @throws {Error} 基类未实现此方法
   * @abstract
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 重置工具状态
   * @throws {Error} 基类未实现此方法
   * @abstract
   */
  reset() {
    throw new Error("Method not implemented.");
  }

  /**
   * 开始使用工具
   * @param {Vector} point - 工具在开始使用时的位置
   * @param {Object} option - 选项
   * @description 对应用户开始使用工具的操作，例如用户按下鼠标或触摸屏幕时调用此方法
   * @abstract
   */
  start(point, option) {
    throw new Error("Method not implemented.");
  }

  /**
   * 结束使用工具
   * @param {Vector} point - 工具在结束使用时的位置
   * @param {Object} option - 选项
   * @description 对应用户结束使用工具的操作，例如用户松开鼠标或触摸屏幕时调用此方法
   * @abstract
   */
  end(point, option) {
    throw new Error("Method not implemented.");
  }

  /**
   * 移动工具
   * @param {Vector} point - 工具在移动时的位置
   * @param {Object} option - 选项
   * @description 对应用户移动工具的操作，例如用户拖动鼠标或触摸屏幕时调用此方法
   * @abstract
   */
  move(point, option) {
    throw new Error("Method not implemented.");
  }
}

export {
  Tool,
};
