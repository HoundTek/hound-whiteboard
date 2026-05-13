/**
 * 多边形修改工具
 * @module core/tools/modifier/polygon
 * @author Zhou Chenyu
 */

import { PolygonObject } from "../../objects/graph/polygon.js";
import { Vector } from "../../utils/math.js";
import { ObjectModifierTool } from "./obj-modifier.js";

/**
 * @class
 * @extends ObjectModifierTool
 * @description
 * @author Zhou Chenyu
 */
class PolygonModifierTool extends ObjectModifierTool {
  /**
   * @constructor
   */
  constructor() {
    super();
  }

  /**
   * 解析序列化的多边形工具数据以创建工具实例
   * @static
   * @param {Object} toolData - 序列化的多边形工具数据
   * @returns {PolygonModifierTool} 创建的多边形工具实例
   */
  static parse(toolData) {
    let tool = new PolygonModifierTool();
    if (!toolData || toolData.type !== "PolygonTool")
      throw new Error("Invalid tool data for PolygonTool.");
    tool.obj = toolData.obj ? PolygonObject.parse(toolData.obj) : null;
    return tool;
  }

  /**
   * 序列化多边形工具实例以保存工具数据
   * @return {Object} 序列化后的多边形工具数据
   */
  serialize() {
    return {
      type: "PolygonTool",
      obj: this.obj ? this.obj.serialize() : null,
    };
  }

  /**
   * @type {PolygonObject}
   * @description 当前正在修改的多边形对象
   */
  obj;

  /**
   * 在指定位置创建一个新的多边形对象
   * @param {Vector} point - 多边形对象的位置
   * @param {number} id - 对象 id
   * @param {number} pageId - 对象所在页的 id
   * @returns {PolygonObject} 创建的多边形对象实例
   * @description 创建新的多边形对象时，初始时只包含一个顶点，后续通过 addPoint 方法添加更多顶点。
   */
  create(point, id, pageId) {
    this.obj = new PolygonObject(point, id, pageId, [new Vector(0, 0)]);
    return this.obj;
  }

  /**
   * 添加一个新的点到多边形对象
   * @param {Vector} point - 添加的点
   */
  addPoint(point) {
    if (!this.obj) return;
    // 这里会导致 UB，但是没关系，因为会 setPoints
    let points = this.obj.points;
    points.push(point);
    this.obj.setPoints(points);
  }

  /**
   * 删除多边形对象中的一个点
   * @param {number} pointIndex - 删除的点的索引
   */
  removePoint(pointIndex) {
    if (!this.obj) return;
    if (this.obj.points.length <= 3) return;
    if (pointIndex < 0 || pointIndex >= this.obj.points.length) return;
    this.obj.setPoints(
      this.obj.points.filter((_, index) => index !== pointIndex)
    );
  }

  /**
   * 移动多边形对象中的一个点到新位置
   * @param {number} oldPointIndex - 旧点的索引
   * @param {Vector} newPoint - 新点的位置
   */
  movePoint(oldPointIndex, newPoint) {
    if (!this.obj) return;
    // 这里会导致 UB，但是没关系，因为会 setPoints
    let points = this.obj.points;
    if (oldPointIndex < 0 || oldPointIndex >= points.length) return;
    points[oldPointIndex] = newPoint;
    this.obj.setPoints(points);
  }

  /**
   * 在多边形对象中的指定位置后插入一个新点
   * @param {number} lastPointIndex - 插入点的索引，-1 表示插入到开头
   * @param {Vector} point - 插入的点
   */
  insertPoint(lastPointIndex, point) {
    if (!this.obj) return;
    // 这里会导致 UB，但是没关系，因为会 setPoints
    let points = this.obj.points;
    if (lastPointIndex < -1 || lastPointIndex >= points.length) return;
    points.splice(lastPointIndex + 1, 0, point);
    this.obj.setPoints(points);
  }

  cut(startPointIndex, endPointIndex) {
    if (!this.obj) return;
    if (
      startPointIndex < 0 ||
      endPointIndex < 0 ||
      endPointIndex >= this.obj.points.length ||
      startPointIndex >= this.obj.points.length ||
      (startPointIndex <= endPointIndex &&
        endPointIndex - startPointIndex + 1 < 3) ||
      (startPointIndex > endPointIndex &&
        this.obj.points.length - (startPointIndex - endPointIndex - 1) < 3)
    ) {
      return;
    }

    // 这里会导致 UB，但是没关系，因为会 setPoints
    let points = this.obj.points;
    if (startPointIndex < endPointIndex) {
      points = points.filter(
        (_, index) => startPointIndex <= index && index <= endPointIndex
      );
    } else {
      points = points.filter(
        (_, index) => index <= endPointIndex || startPointIndex <= index
      );
    }

    this.obj.setPoints(points);
  }

  reset() {
    // 相信 node 的 GC
    this.obj = null;
  }

  /**
   * 设置多边形对象的颜色
   * @param {string} color - 颜色字符串
   */
  setColor(color) {
    if (!this.obj) return;
    this.obj.color = color;
  }

  /**
   * 设置多边形对象的变换矩阵
   * @param {Object} transform - 变换矩阵
   */
  setTransform(transform) {
    if (!this.obj) return;
    this.obj.setTransform(transform);
  }
}

export {
  PolygonModifierTool,
};
