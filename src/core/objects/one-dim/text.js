/**
 * @file 文本对象定义
 * @description 定义白板文本对象的数据结构和渲染行为。
 * @module core/objects/one-dim/text
 * @author Zhou Chenyu
 */

import { OneDimensionObject } from "./one-dim-obj.js";
import { Vector, Matrix } from "../../utils/math.js";
import { PolygonRange, RectangleRange } from "../../range/index.js";

const DEFAULT_TEXT_PROPERTY = Object.freeze({
  color: "#000000",
  size: 16,
  font: "Arial",
  strokeWidth: 1,
});

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
   * @constructor
   */
  constructor(p, id) {
    super(p, id);
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

  property = { ...DEFAULT_TEXT_PROPERTY };

  setProperty(property = {}, ctx) {
    super.setProperty(property);
    this.divideText(ctx);
    return this.property;
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
    const height = this.property.size * 1.2 * this.dividedText.length;
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
    ctx.fillStyle = this.property.color;
    ctx.font = `${this.property.size}px ${this.property.font}`;
    ctx.globalCompositeOperation = "source-over";
    const rectangle = RectangleRange.from(this.localTextRange);
    if (this.dividedText) {
      this.dividedText.forEach((line, index) => {
        ctx.fillText(line, 0, (index + 1 / 1.2) * this.property.size * 1.2);
      });
      if (
        Number.isFinite(this.property.strokeWidth) &&
        this.property.strokeWidth > 0
      ) {
        ctx.strokeStyle = this.property.color;
        ctx.lineWidth = this.property.strokeWidth;
        ctx.strokeRect(
          rectangle.left,
          rectangle.top,
          rectangle.width,
          rectangle.height,
        );
      }
    }
    ctx.restore();
  }

  serialize() {
    return {
      ...super.serialize(),
      type: "TextObject",
      data: { text: this.text, ihatLength: this.ihatLength },
    };
  }

  static parse(data) {
    if (data.type !== "TextObject") {
      throw new TypeError("Invalid type for TextObject parsing");
    }

    let obj = new TextObject(
      Vector.parse(data.position),
      data.id,
    );
    obj.setTransform(Matrix.parse(data.transform));
    obj.setProperty({
      ...DEFAULT_TEXT_PROPERTY,
      ...(data.property ?? {}),
    });
    obj.setText(data.data?.text ?? "");
    obj.setIhatLength(data.data?.ihatLength ?? obj.ihatLength);
    return obj;
  }
}

export { DEFAULT_TEXT_PROPERTY, TextObject };
