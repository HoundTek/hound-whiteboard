/**
 * @file 显示器组件
 * @module core/components/monitor
 * @author Zhou Chenyu
 */

import { Device } from "../devices/device.js";

/**
 * 显示器组件
 * @class
 * @description 显示器组件负责显示内容和管理页加载缓冲区。
 * @author Zhou Chenyu
 */
class Monitor {
  /**
   * 显示器组件下辖的设备列表
   * @type {Device[]}
   */
  devices = [];

  /**
   * 显示器组件的画布
   * @type {HTMLCanvasElement}
   * @todo 现在还没有转移到 React，所以用原生 html。
   */
  canvas;

  /**
   * 页加载缓冲区管理器
   * @type {PageLoadManager}
   */
  pageLoadManager;

  constructor() {}
}

export {
  Monitor,
};
