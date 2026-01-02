const { Container } = require("../container");

/**
 * 一维对象基类
 * @abstract
 * @class
 * @extends Container
 * @description 表示一维对象，对象自身只有长度没有宽度 (或只有长度没有宽度)
 * @author Zhou Chenyu
 */
class OneDimensionObject extends Container {
  /**
   * 标识该一维对象的主轴是否是 x 轴
   * @type {boolean}
   * @static
   * @description true 表示主轴是 x 轴（水平），false 表示主轴是 y 轴（垂直）
   */
  static isMainAxisX = true;

  /**
   * 一维对象的主轴长度
   * @type {number}
   */
  mainAxisLength = 0;

  /**
   * 创建一个新的一维对象
   * @param {Point} p - 对象的初始位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 对象所在页的 id
   * @constructor
   */
  constructor(p, id, pageId) {
    super(p, id, pageId);
  }
}

module.exports = {
  OneDimensionObject,
};
