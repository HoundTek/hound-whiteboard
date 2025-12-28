/**
 * @file 文本对象定义
 * @module board/text
 * @author Zhou Chenyu
 */

const { Quark, TextQuark } = require("../quarks");
const { OneDimensionObject } = require("../basic-classes");
const { Point } = require("../../../utils/math");

/**
 * 文本对象类
 * @class
 * @extends OneDimensionObject
 * @author Zhou Chenyu
 */
class TextObject extends OneDimensionObject {
  /**
   * 创建一个新的多边形对象
   * @param {Point} p - 多边形逻辑左上角的绝对位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 对象所在页的 id
   * @param {string} text - 文本内容
   * @constructor
   */
  constructor(p, id, pageId, text) {
    super(p, id, pageId, false, true, true);
    if (text) {
      this.text = text;
    }
  }

  /**
   * @description 文本对象的凸包就是其矩形边界。
   */
  calculateConvexHull() {
    this.convexHull = this.rectangle;
  }

  /**
   * 文本对象的颜色
   * @type {string}
   * @default "#000000"
   */
  color = "#000000";

  /**
   * 文本内容
   * @type {string}
   * @default ""
   */
  text = "";

  /**
   * 字号大小
   * @type {number}
   * @default 16
   */
  size = 16;

  /**
   * 字体名称
   * @type {string}
   * @default "Arial"
   */
  font = "Arial";

  /**
   * @returns {Quark[]}
   */
  getQuarks() {
    let quark = new TextQuark(
      this.position,
      this.text,
      this.size,
      this.color,
      this.font
    );
    return [quark];
  }
}

module.exports = {
  TextObject,
};
