/**
 * @file 对象容器定义
 * @description 定义将对象零维化并管理其容器关系的基础实现。
 * @module core/shared/objects/container
 * @author Zhou Chenyu
 */

import { BasicObject } from "./basic-obj.js";
import { Vector } from "../../utils/math.js";

/**
 * 对象容器类
 * @class
 * @extends BasicObject
 * @description
 * 对象容器是使一维对象和二维对象零维化的媒介。它将使所有被白板直接管理的对象是零维的，也使用户操作更为直观。
 *
 * 对象容器有以下几种模式:
 * - 普通模式: 容器直接显示内部对象，可以认为这个容器不存在
 * - 拉伸模式: 内部对象以拉伸的方式填充容器，此模式与其它模式不一样的是，操纵杆可以直接调整其变换矩阵
 * - 窗口模式: 对二维对象，其表现与普通模式相同；对一维对象，若其非主轴被缩得过分小会被裁切
 * - 收缩模式: 不改变内部对象宽高比，而是将其收缩以适应容器
 *
 * 用户通过“进入”容器来修改内部对象的内容 (不是更改对象！)。
 * @author Zhou Chenyu
 */
class Container extends BasicObject {
  /**
   * 容器的工作模式
   * @type {ContainerMode}
   */
  mode;

  isDirected() {
    return false;
  }

  isErasable() {
    return false;
  }

  /**
   * 创建一个新的容器对象
   * @param {number} id - 对象 id
   * @param {Vector} position - 容器的位置
   * @param {Record<string, any>} [property={}] - 对象属性
   * @param {Record<string, any>} [data={}] - 对象类型专属数据
   * @constructor
   */
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
  }
}

class ContainerMode {
  /**
   * @type {string}
   * @private
   */
  state;

  constructor(state) {
    this.state = state;
  }

  toString() {
    return this.state;
  }

  static parse(str) {
    return new ContainerMode(str);
  }

  /**
   * 普通模式
   * @type {ContainerMode}
   * @description 容器直接显示内部对象，可以认为这个容器不存在。
   */
  static NORMAL = new ContainerMode("NORMAL");

  /**
   * 拉伸模式
   * @type {ContainerMode}
   * @description 内部对象以拉伸的方式填充容器，此模式与其它模式不一样的是，操纵杆可以直接调整其变换矩阵。
   */
  static STRETCH = new ContainerMode("STRETCH");

  /**
   * 窗口模式
   * @type {ContainerMode}
   * @description 对二维对象，其表现与普通模式相同；对一维对象，若其非主轴被缩得过分小会被裁切。
   */
  static WINDOW = new ContainerMode("WINDOW");

  /**
   * 收缩模式
   * @type {ContainerMode}
   * @description 不改变内部对象宽高比，而是将其收缩以适应容器
   */
  static SHRINK = new ContainerMode("SHRINK");
}

export { Container, ContainerMode };
