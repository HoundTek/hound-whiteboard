/**
 * @file 文本对象定义
 * @module core/objects/one-dim/text
 * @author Zhou Chenyu
 */

import { OneDimensionObject } from "./one-dim-obj.js";
import { Vector, Matrix } from "../../utils/math.js";
import { PolygonRange, RectangleRange } from "../../range/index.js";

/**
 * 文本对象类
 * @class
 * @extends OneDimensionObject
 * @author Zhou Chenyu
 */
class TextObject extends OneDimensionObject {
  syncRanges() {
    if (this.localTextRange.points.length === 0) {
      this.worldTextRange = new PolygonRange([]);
      this.boundingBox = new RectangleRange(0, 0, 0, 0);
      this.convexHullRange = new PolygonRange([]);
      return;
    }
    this.worldTextRange = this.localTextRange.transform(this.transform);
    this.boundingBox = RectangleRange.from(this.worldTextRange);
    this.calculateConvexHull();
  }

  /**
   * 创建一个新的文本对象
   * @param {Vector} p - 文本左上角的绝对位置
   * @param {number} id - 对象 id
   * @param {number} ownerPageId - 对象归属页的 id
   * @constructor
   */
  constructor(p, id, ownerPageId) {
    super(p, id, ownerPageId);
  }

  /**
   * @description 文本对象的凸包就是其矩形边界。
   */
  calculateConvexHull() {
    this.convexHullRange = PolygonRange.from(this.localTextRange);
  }

  /**
   * 文本主判定范围
   * @type {PolygonRange}
   */
  localTextRange = new PolygonRange([]);

  /**
   * 变换后的文本主判定范围
   * @type {PolygonRange}
   */
  worldTextRange = new PolygonRange([]);

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
    const height = this.textProperty.size * 1.2 * this.dividedText.length;
    this.localTextRange = new PolygonRange([
      new Vector(0, 0),
      new Vector(this.ihatLength, 0),
      new Vector(this.ihatLength, height),
      new Vector(0, height),
    ]);
    this.syncRanges();
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

  setTransform(trans) {
    this.transform = trans;
    this.syncRanges();
  }

  getRange() {
    return this.worldTextRange;
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
      this.position.y,
    );
    ctx.fillStyle = this.textProperty.color;
    ctx.font = `${this.textProperty.size}px ${this.textProperty.font}`;
    ctx.globalCompositeOperation = "source-over";
    const rectangle = RectangleRange.from(this.localTextRange);
    if (this.dividedText) {
      this.dividedText.forEach((line, index) => {
        ctx.fillText(line, 0, (index + 1 / 1.2) * this.textProperty.size * 1.2);
      });
      ctx.strokeStyle = this.textProperty.color;
      ctx.strokeRect(
        rectangle.minX,
        rectangle.minY,
        rectangle.maxX - rectangle.minX,
        rectangle.maxY - rectangle.minY,
      );
    }
    ctx.restore();
  }

  serialize() {
    return {
      type: "TextObject",
      ...super.serialize(),
      text: this.text,
      textProperty: this.textProperty,
      ihatLength: this.ihatLength,
    };
  }

  static parse(data) {
    if (data.type !== "TextObject") {
      throw new TypeError("Invalid type for TextObject parsing");
    }

    let obj = new TextObject(
      Vector.parse(data.position),
      data.id,
      data.ownerPageId,
    );
    obj.setTransform(Matrix.parse(data.transform));
    obj.setText(data.text);
    obj.setTextProperty(data.textProperty ?? {});
    obj.setIhatLength(data.ihatLength ?? obj.ihatLength);
    return obj;
  }
}

export { TextObject };
