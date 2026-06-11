/**
 * @file 圆形创建工具
 * @description 提供单手势圆对象创建器工具实现。
 * @module core/tools/creator/circle-creator
 * @author Zhou Chenyu
 */

import {
  CircleObject,
  DEFAULT_CIRCLE_PROPERTY,
} from "../../objects/graph/circle.js";
import { SingleGestureObjectCreatorTool } from "./obj-creator.js";
import { Vector } from "../../utils/math.js";

const DEFAULT_FIXED_RADIUS_SCREEN = 16;
const DEFAULT_MIN_DRAG_DISTANCE_SCREEN = 4;

/**
 * 圆创建工具类
 * @class
 * @extends SingleGestureObjectCreatorTool
 * @description
 * 单手势创建圆对象：
 * - 手势开始点为圆心
 * - 手势结束点决定半径
 * - 若手势位移过小，则按 monitor.zoom 生成固定半径圆
 * @author Zhou Chenyu
 */
class CircleCreatorTool extends SingleGestureObjectCreatorTool {
  /**
   * 当前正在创建的圆对象
   * @type {CircleObject}
   */
  obj;

  /**
   * 圆对象的属性
   * @type {Record<string, any>}
   */
  property;

  /**
   * 默认半径（屏幕坐标系）
   * @type {number}
   */
  fixedRadiusScreen;

  /**
   * 最小拖动距离（屏幕坐标系）
   * @type {number}
   */
  minDragDistanceScreen;

  /**
   * @param {{
   *   property?: Partial<typeof DEFAULT_CIRCLE_PROPERTY>,
   *   fixedRadiusScreen?: number,
   *   minDragDistanceScreen?: number,
   * }} [options={}]
   * @constructor
   */
  constructor(options = {}) {
    super(options);
    this.property = {
      ...DEFAULT_CIRCLE_PROPERTY,
      ...(options.property ?? {}),
    };
    this.fixedRadiusScreen =
      options.fixedRadiusScreen ?? DEFAULT_FIXED_RADIUS_SCREEN;
    this.minDragDistanceScreen =
      options.minDragDistanceScreen ?? DEFAULT_MIN_DRAG_DISTANCE_SCREEN;
  }

  create(p, id, ownerChunkId) {
    this.obj = new CircleObject(p, id, ownerChunkId);
    this.obj.setProperty(this.property);
  }

  /**
   * 将世界坐标转换为对象局部坐标
   * @param {Vector} position
   * @returns {Vector}
   */
  toLocalPoint(position) {
    return position.sub(this.obj.position);
  }

  /**
   * 当前手势的点数
   * @type {number}
   */
  count;

  beginCreationGesture(interaction) {
    this.count = 0;
    this.obj.setRadius(0);
  }

  updateCreationGesture(interaction) {
    this.count++;
    const localPoint = this.toLocalPoint(interaction.position);
    const radius = localPoint.length();
    this.obj.setRadius(radius);
  }

  completeCreationGesture(interaction) {
    if (interaction.position) {
      this.count++;
      const localPoint = this.toLocalPoint(interaction.position);
      const radius = localPoint.length();
      this.obj.setRadius(radius);
    }
    const zoom = interaction.context?.context?.monitor?.zoom ?? 1;
    if (
      this.count <= 2 &&
      this.obj.radius < this.minDragDistanceScreen / zoom
    ) {
      this.obj.setRadius(this.fixedRadiusScreen / zoom);
    }
  }
}

export { CircleCreatorTool };
