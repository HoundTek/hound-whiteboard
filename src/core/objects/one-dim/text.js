/**
 * @file 文本对象定义
 * @module board/text
 * @author Zhou Chenyu
 */

const { OneDimensionObject } = require("./one-dim-obj");
const { Point, Matrix } = require("../../../utils/math");

/**
 * 文本对象类
 * @class
 * @extends OneDimensionObject
 * @author Zhou Chenyu
 */
class TextObject extends OneDimensionObject {
  /**
   * 创建一个新的文本对象
   * @param {Point} p - 文本左上角的绝对位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 对象所在页的 id
   * @constructor
   */
  constructor(p, id, pageId) {
    super(p, id, pageId);
  }

  /**
   * @description 文本对象的凸包就是其矩形边界。
   */
  calculateConvexHull() {
    this.convexHull = this.rectangle;
  }

  textProperty = {
    /**
     * 文本颜色
     * @type {string}
     * @default "#000000"
     */
    color: "#000000",

    /**
     * 字号大小
     * @type {number}
     * @default 16
     */
    size: 16,

    /**
     * 字体名称
     * @type {string}
     * @default "Arial"
     */
    font: "Arial",
  };

  /**
   * @param {{color?: string, size?: number, font?: string}} param0 - 文字的属性
   * @param {CanvasRenderingContext2D} ctx - 画布上下文
   */
  setTextProperty({ color, size, font }, ctx) {
    if (color) {
      this.textProperty.color = color;
    }
    if (size) {
      this.textProperty.size = size;
    }
    if (font) {
      this.textProperty.font = font;
    }
    this.divideText(ctx);
  }

  /**
   * 文本内容
   * @type {string}
   * @default ""
   */
  text = "";

  setText(text, ctx) {
    this.text = text;
    this.divideText(ctx);
  }

  /**
   * 分行后的文本内容
   * @type {string[]}
   * @description 根据主轴长度和文本自身内容分行后的文本内容数组
   */
  dividedText;

  /**
   * 将文本根据最大宽度进行分行处理，支持中英文混合分词。
   * 英文按空格分词，中文按字符分词，并将结果存储在 dividedText 中。
   * @param {CanvasRenderingContext2D} ctx - 画面上下文
   * @todo 实现文本分行功能
   */
  divideText(ctx) {
    this.dividedText = [this.text];
    this.rectangle = new Matrix(
      0,
      0,
      this.ihatLength,
      this.textProperty.size * 1.2 * this.dividedText.length
    );
  }

  /**
   * 文本框的主轴长度
   * @type {number}
   * @description 目前仅支持水平文本框。
   * @default 400
   */
  ihatLength = 400;

  setIhatLength(length, ctx) {
    this.ihatLength = length;
    this.divideText(ctx);
  }

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
    ctx.fillStyle = this.textProperty.color;
    ctx.font = `${this.textProperty.size}px ${this.textProperty.font}`;
    ctx.globalCompositeOperation = "source-over";
    if (this.dividedText) {
      this.dividedText.forEach((line, index) => {
        ctx.fillText(line, 0, (index + 1 / 1.2) * this.textProperty.size * 1.2);
      });
      ctx.strokeStyle = this.textProperty.color;
      ctx.strokeRect(
        this.rectangle.a,
        this.rectangle.b,
        this.rectangle.c,
        this.rectangle.d
      );
    }
    ctx.restore();
  }
}

module.exports = {
  TextObject,
};
