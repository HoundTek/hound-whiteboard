/**
 * @file 显示器设备
 * @module core/devices/monitor
 * @author Zhou Chenyu
 */

const { Device } = require("./device");

class Monitor {
  /**
   * 显示器设备下辖的设备列表
   * @type {Device[]}
   */
  devices = [];

  /**
   * 显示器设备的画布
   * @type {HTMLCanvasElement}
   */
  canvas;

  constructor() {}
}

module.exports = {
  Monitor,
};
