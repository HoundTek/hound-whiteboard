/**
 * @file 多边形创建工具
 * @description 提供用于绘制多边形对象的创建器工具实现。
 * @module core/ui/tools/creator/polygon-creator
 * @author Zhou Chenyu
 */

import { DEFAULT_POLYGON_PROPERTY } from "../../../shared/objects/graph/polygon.js";
import { Vector } from "../../../utils/math.js";
import { MultiGestureObjectCreatorTool } from "./object-creator.js";

/**
 * 多边形创建工具类
 * @class
 * @extends ObjectCreatorTool
 * @description
 * 多边形创建工具允许用户在白板上绘制多边形对象。
 *
 * 用户可以通过点击来添加多边形的顶点，形成所需的形状。
 * 或者拖动操作杆来调整顶点位置以修改多边形的形状。
 *
 * 当用户完成绘制后，可以通过点击菜单中的完成按钮来结束绘制过程。（todo）
 * @author Zhou Chenyu
 */
class PolygonCreatorTool extends MultiGestureObjectCreatorTool {
  /**
   * @param {{
   *   property?: Partial<typeof DEFAULT_POLYGON_PROPERTY>,
   * }} [options={}]
   */
  constructor(options = {}) {
    super(options);
    this.count = 0;
    this.lastPoint = null;
    this.property = {
      ...DEFAULT_POLYGON_PROPERTY,
      ...(options.property ?? {}),
    };
  }

  getCreatedObjectType() {
    return "PolygonObject";
  }

  /**
   * 解析序列化的多边形工具数据以创建工具实例
   * @static
   * @param {Object} toolData - 序列化的多边形工具数据
   * @returns {PolygonCreatorTool} 创建的多边形工具实例
   * @todo
   */
  static parse(toolData) {
    let tool = new PolygonCreatorTool({ property: toolData?.property });
    if (!toolData || toolData.type !== "PolygonTool")
      throw new Error("Invalid tool data for PolygonTool.");
    if (toolData._entry) {
      tool._entry = { ...toolData._entry };
    }
    return tool;
  }

  /**
   * 序列化多边形工具实例以保存工具数据
   * @return {Object} 序列化后的多边形工具数据
   * @todo
   */
  serialize() {
    return {
      type: "PolygonTool",
      property: { ...(this.property ?? {}) },
      _entry: this._entry
        ? {
            id: this._entry.id,
            type: this._entry.type,
            position: { x: this._entry.position.x, y: this._entry.position.y },
            property: { ...this._entry.property },
            data: { ...this._entry.data },
          }
        : null,
    };
  }

  /**
   * 当前正在创建多边形对象的本地状态
   * @type {import("../../shared/types.js").LightweightObjectEntry & { data: { points: Array<{x:number, y:number}> } } | null}
   */
  _entry;

  /**
   * 当前顶点数量
   * @type {number}
   */
  count;

  /**
   * 上一个顶点位置
   * @type {Vector}
   */
  lastPoint;

  /**
   * 多边形属性
   * @type {Record<string, any>}
   */
  property;

  /**
   * @param {Vector} position - 对象位置
   * @param {number} id - 对象 id
   */
  create(position, id) {
    this._entry = {
      id,
      type: "PolygonObject",
      position: new Vector(position.x, position.y),
      property: { ...this.property },
      data: { points: [] },
    };
  }

  /**
   * 将世界坐标转换为对象局部坐标
   * @param {Vector} position
   * @returns {Vector}
   */
  toLocalPoint(position) {
    return position.sub(this._entry.position);
  }

  /**
   * 追加顶点到多边形
   * @param {Vector} localPoint - 局部坐标
   * @param {Object} interaction - 当前交互上下文
   */
  appendPoint(localPoint, interaction) {
    if (this._entry) {
      this._entry.data.points.push({ x: localPoint.x, y: localPoint.y });
    }

    const boardApi = interaction?.context?.acc?.boardApi;
    if (!boardApi || this.objectId == null) {
      return;
    }

    boardApi.appendListItem(this.objectId, "points", [
      { x: localPoint.x, y: localPoint.y },
    ]);
  }

  /**
   * 替换多边形当前顶点
   * @param {Vector} localPoint - 新的局部坐标
   * @param {number} index - 顶点索引
   * @param {Object} interaction - 当前交互上下文
   */
  replacePoint(localPoint, index, interaction) {
    if (this._entry) {
      this._entry.data.points[index] = { x: localPoint.x, y: localPoint.y };
    }

    const boardApi = interaction?.context?.acc?.boardApi;
    if (!boardApi || this.objectId == null) {
      return;
    }

    boardApi.replaceListItem(this.objectId, "points", index, {
      x: localPoint.x,
      y: localPoint.y,
    });
  }

  /**
   * @description 创建手势开始时，添加一个新的顶点。
   * @param {Object} interaction - 当前交互上下文
   */
  beginGesture(interaction) {
    const addPt = this.toLocalPoint(interaction.position);
    this.appendPoint(addPt, interaction);
    this.lastPoint = interaction.position;
    this.count++;
  }

  /**
   * @description 创建手势更新时，修改当前顶点位置。
   * @param {Object} interaction - 当前交互上下文
   */
  updateGesture(interaction) {
    if (!Vector.nearlyEq(this.lastPoint, interaction.position)) {
      this.lastPoint = interaction.position;
      const upPt = this.toLocalPoint(interaction.position);
      this.replacePoint(upPt, this.count - 1, interaction);
    }
    this.afterGeometryMutation(interaction);
  }

  /**
   * @description 创建手势结束时，固定当前顶点并追加控制点。
   * @param {Object} interaction - 当前交互上下文
   */
  completeGesture(interaction) {
    if (
      interaction.position &&
      !Vector.nearlyEq(this.lastPoint, interaction.position)
    ) {
      this.lastPoint = interaction.position;
      const compPt = this.toLocalPoint(interaction.position);
      this.replacePoint(compPt, this.count - 1, interaction);
    }

    this.lastPoint = null;
  }

  cancelGesture(interaction) {
    return undefined;
  }

  /**
   * 根据累积的顶点计算局部外接矩形
   * @param {Object} interaction - 当前交互上下文
   * @returns {{ left: number, top: number, width: number, height: number }|undefined}
   * @protected
   */
  resolveCreatedObjectBoundingBox(interaction) {
    const points = this._entry?.data?.points;
    if (!points || points.length === 0) return undefined;
    let minX = Infinity,
      minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  }

  reset() {
    this._entry = null;
    this.objectId = null;
    this.count = 0;
    this.lastPoint = null;
  }
}

export { PolygonCreatorTool };
