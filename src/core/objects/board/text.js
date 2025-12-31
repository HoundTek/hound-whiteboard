/**
 * @file 文本对象定义
 * @module board/text
 * @author Zhou Chenyu
 */

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
   * 渲染文字到画布上下文
   * @param {CanvasRenderingContext2D} ctx - 画布上下文
   */
  render(ctx) {
    ctx.save();
    ctx.setTransform(
      this.transform.a,
      this.transform.b,
      this.transform.c,
      this.transform.d,
      this.position.x,
      this.position.y
    );
    ctx.fillStyle = this.color;
    ctx.font = `${this.size}px ${this.font}`;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillText(this.text, 0, 0);
    ctx.restore();
  }
}

module.exports = {
  TextObject,
};
