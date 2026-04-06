/**
 * @file 测试设备
 * @module core/device/test-device
 * @author Zhou Chenyu
 */

import { Device } from "./device.js";
/**
 * 测试设备类
 * @class
 * @extends Device
 * @description 用于调试
 * @author Zhou Chenyu
 */
class DebuggerDevice extends Device {
  /**
   * 设备名称
   * @type {string}
   */
  name = "Debugger Device";

  constructor() {
    super();
  }
}

export {
  DebuggerDevice,
};
