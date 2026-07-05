/**
 * @file 笔画创建工具
 * @description 提供用于绘制笔画对象的创建器工具实现。
 * @module core/tools/creator/stroke-creator
 * @author Zhou Chenyu
 */

import { DEFAULT_STROKE_PROPERTY } from "../../objects/stroke/stroke.js";
import { SingleGestureObjectCreatorTool } from "./object-creator.js";
import { Vector } from "../../utils/math.js";

/**
 * 笔画创建工具类
 * @class
 * @extends SingleGestureObjectCreatorTool
 * @description
 * 单手势创建笔画对象：
 * - 手势开始点为笔画起点
 * - 手势结束点为笔画终点
 * - 手势路径为笔画路径
 * @author Zhou Chenyu
 */
class StrokeCreatorTool extends SingleGestureObjectCreatorTool {
  /**
   * 当前正在创建笔画对象的本地状态
   * @type {import("../../shared/types.js").LightweightObjectEntry & { data: { points: Array<{x:number, y:number}> } } | null}
   */
  _entry;

  /**
   * 笔画对象的属性
   * @type {Record<string, any>}
   */
  property;

  /**
   * 最近一次追加的局部路径点
   * @type {Vector | null}
   */
  _lastLocalPoint;

  /**
   * @param {{
   *   property?: Partial<typeof DEFAULT_STROKE_PROPERTY>,
   * }} [options={}]
   * @constructor
   */
  constructor(options = {}) {
    super(options);
    this.property = {
      ...DEFAULT_STROKE_PROPERTY,
      ...(options.property ?? {}),
    };
    this._lastLocalPoint = null;
  }

  getCreatedObjectType() {
    return "StrokeObject";
  }

  create(p, id) {
    this._entry = {
      id,
      type: "StrokeObject",
      position: new Vector(p.x, p.y),
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
   * 追加一个局部路径点
   * @param {Vector} point - 待追加的局部路径点
   * @param {Object} interaction - 当前交互上下文
   */
  appendPathPoint(point, interaction) {
    const points = this._entry?.data?.points;
    const currentLastPoint =
      points?.length > 0 ? points[points.length - 1] : undefined;
    if (
      (this._lastLocalPoint && Vector.nearlyEq(this._lastLocalPoint, point)) ||
      (currentLastPoint && Vector.nearlyEq(currentLastPoint, point))
    ) {
      return;
    }

    if (this._entry) {
      this._entry.data.points.push({ x: point.x, y: point.y });
    }

    const boardApi = interaction?.context?.acc?.boardApi;
    if (boardApi && this.objectId != null) {
      boardApi.appendListItem(this.objectId, "points", [
        { x: point.x, y: point.y },
      ]);
    }

    this._lastLocalPoint = new Vector(point.x, point.y);
  }

  beginCreationGesture(interaction) {
    this._lastLocalPoint = null;
    this.appendPathPoint(this.toLocalPoint(interaction.position), interaction);
  }

  updateCreationGesture(interaction) {
    this.appendPathPoint(this.toLocalPoint(interaction.position), interaction);
  }

  completeCreationGesture(interaction) {
    if (interaction.position) {
      this.appendPathPoint(
        this.toLocalPoint(interaction.position),
        interaction,
      );
    }
  }

  /**
   * 根据累积的路径点计算局部外接矩形
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
    this._lastLocalPoint = null;
  }
}

export { StrokeCreatorTool };
