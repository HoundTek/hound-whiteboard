/**
 * @file 对象容器定义
 * @module board/container
 * @author Zhou Chenyu
 */

const {
  ZeroDimensionObject,
  OneDimensionObject,
  TwoDimensionObject,
} = require("../basic-classes");

const { Quark } = require("../quarks");
const { Point } = require("../../../utils/math");

/**
 * 对象容器类
 * @class
 * @extends ZeroDimensionObject
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
class Container extends ZeroDimensionObject {
  /**
   * 容器中存储的内部对象
   * @type {OneDimensionObject | TwoDimensionObject}
   * @description 只能是一维对象或二维对象
   */
  child;

  /**
   * 创建一个新的容器对象
   * @param {Point} p - 容器的位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 对象所在页的 id
   * @param {OneDimensionObject | TwoDimensionObject} child - 容器的子对象
   * @constructor
   */
  constructor(p, id, pageId, child) {
    super(p, id, pageId, false);
    this.child = child;
  }

  /**
   * 获取容器的渲染 Quark
   * @returns {Quark[]} 子对象的 Quark
   * @description 容器本身不渲染，而是返回子对象的 Quark
   */
  getQuarks() {
    return this.child.getQuarks();
  }
}

module.exports = {
  Container,
};
