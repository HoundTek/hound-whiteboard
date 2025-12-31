/**
 * 控制杆基类
 * @module core/tools/controller/controller
 * @author Zhou Chenyu
 */

const { Point } = require("../../../utils/math");

/**
 * 控制杆基类
 * @class
 * @author Zhou Chenyu
 * @description
 * 控制杆用于对象的调整和变换操作。
 * 通过控制杆，用户可以对对象进行缩放、旋转等操作。
 * 控制杆通常附加在对象的边界上，用户可以通过拖动控制杆来调整对象的属性。
 *
 * 控制杆的具体实现应继承此类并实现其特定功能。
 * 控制杆应包括位置、类型等属性。由前端根据对象的类型和状态动态生成控制杆的 React 组件。
 * @abstract
 */
class Controller {
  /**
   * @type {Point}
   */
  position;

  /**
   * @constructor
   * @param {Object} position - 控制杆位置
   */
  constructor(position) {
    this.position = position;
  }

  setPosition(position) {
    this.position = position;
  }
}

module.exports = {
  Controller,
};
