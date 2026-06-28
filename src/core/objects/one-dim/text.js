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
    if (this.rich.localTextRange.points.length === 0) {
      this.rich.worldTextRange = new PolygonRange([]);
      this.rich.boundingBox = new RectangleRange(0, 0, 0, 0);
      this.rich.convexHullRange = new PolygonRange([]);
      return;
    }
    this.rich.worldTextRange = this.rich.localTextRange.transform(
      this.transform,
    );
    this.rich.boundingBox = RectangleRange.from(this.rich.worldTextRange);
    this.calculateConvexHull();
  }

  /**
   * 创建一个新的文本对象
   * @param {number} id - 对象 id
   * @param {Vector} position - 文本左上角的绝对位置
   * @param {Record<string, any>} [property={}] - 对象属性
   * @param {Record<string, any>} [data={}] - 对象类型专属数据
   * @constructor
   */
  constructor(id, position, property = {}, data = {}) {
    super(id, position, property, data);
    this.property = { ...DEFAULT_TEXT_PROPERTY, ...this.property };
    this.rich.localTextRange = new PolygonRange([]);
    this.rich.worldTextRange = new PolygonRange([]);
    this.divideText();
  }

  /**
   * @description 文本对象的凸包就是其矩形边界。
   */
  calculateConvexHull() {
    this.rich.convexHullRange = PolygonRange.from(this.rich.localTextRange);
  }

  setProperty(property = {}, ctx) {
    super.setProperty(property);
    this.divideText(ctx);
    return this.property;
  }

  setText(text, ctx) {
    this.data.text = text;
    this.divideText(ctx);
  }

  /**
   * 将文本根据最大宽度进行分行处理，支持中英文混合分词。
   * 英文按空格分词，中文按字符分词，并将结果存储在 dividedText 中。
   * @param {CanvasRenderingContext2D} ctx - 画面上下文
   * @todo 实现文本分行功能
   */
  divideText(ctx) {
    this.rich.dividedText = [this.data.text ?? ""];
    const height = this.property.size * 1.2 * this.rich.dividedText.length;
    this.rich.localTextRange = new PolygonRange([
      new Vector(0, 0),
      new Vector(this.data.ihatLength ?? 400, 0),
      new Vector(this.data.ihatLength ?? 400, height),
      new Vector(0, height),
    ]);
    this.syncRanges();
  }

  setIhatLength(length, ctx) {
    this.data.ihatLength = length;
    this.divideText(ctx);
  }

  setTransform(trans) {
    this.transform = trans;
    this.syncRanges();
  }

  getRange() {
    return this.rich.worldTextRange;
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
    const rectangle = RectangleRange.from(this.rich.localTextRange);
    if (this.rich.dividedText) {
      this.rich.dividedText.forEach((line, index) => {
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
      data: { ...this.data },
    };
  }

  static parse(serialized) {
    if (serialized.type !== "TextObject") {
      throw new TypeError("Invalid type for TextObject parsing");
    }

    let obj = new TextObject(
      serialized.id,
      Vector.parse(serialized.position),
      { ...DEFAULT_TEXT_PROPERTY, ...(serialized.property ?? {}) },
      {
        ...(serialized.data ?? {}),
      },
    );
    obj.setTransform(Matrix.parse(serialized.transform));
    return obj;
  }
}

export { DEFAULT_TEXT_PROPERTY, TextObject };
