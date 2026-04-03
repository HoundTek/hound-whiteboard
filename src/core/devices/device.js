/**
 * @file 设备基类
 * @module core/device/device
 * @author Zhou Chenyu
 */

const { Tool } = require("../tools/tool");

class Device {
  /**
   * 设备名称
   * @type {string}
   */
  name;

  constructor() {
  };

  /**
   * 设备的工具链
   * @type {Tool[]}
   */
  toolChain = [];

  /**
   * 将工具添加到工具链中
   * @param {Tool} tool - 要添加的工具
   * @return {Tool} 添加后的当前工具
   */
  toolPush(tool) {
    this.toolChain.push(tool);
    return tool;
  }

  /**
   * 从工具链中移除最后一个工具
   * @returns {Tool} 移除后的当前工具
   */
  toolPop() {
    this.toolChain.pop();
    return this.toolChain[this.toolChain.length - 1];
  }
}

module.exports = {
  Device,
};
