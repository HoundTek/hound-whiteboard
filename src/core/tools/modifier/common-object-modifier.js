/**
 * @file 通用对象修改工具（手势驱动）
 * @description
 * 基于手势位置的对象修改工具。消费 position / end / success 信号，
 * 内部以手势起始位置为锚点计算位移并更新对象位置。
 * end 结束当前手势但不提交（对象仍在动态图中），success 将修改提交到静态图。
 * @module core/tools/modifier/common-object-modifier
 * @author Zhou Chenyu
 */

import { Vector } from "../../utils/math.js";
import { RectangleRange } from "../../range/index.js";
import { GestureBasedObjectModifierTool } from "./obj-modifier.js";
import { BasicObject } from "../../objects/basic-obj.js";

/**
 * 通用对象修改工具类
 *
 * @class
 * @extends GestureBasedObjectModifierTool
 * @description
 * 手势驱动的对象位置修改工具，适用于所有对象类型。
 *
 * 手势生命周期（由基类 GestureBasedObjectModifierTool 编排）：
 * 1. 首个 position 信号 → canBeginModifyGesture 准入检测 → beginModifyGesture 记录锚点
 * 2. 后续 position 信号 → updateModifyGesture 以锚点为基准更新对象位置
 * 3. end 信号 → completeModifyGesture 清空锚点，对象留在动态图
 * 4. cancel 信号 → cancelModifyGesture 将对象回滚到手势初始位置
 * 5. success 信号 → 对象提交到静态图
 *
 * @author Zhou Chenyu
 */
class CommonObjectModifierTool extends GestureBasedObjectModifierTool {
  /**
   * 手势锚点（世界坐标）
   * @type {{ x: number, y: number }|null}
   * @private
   */
  _anchorPosition;

  /**
   * 手势开始时各对象的初始位置
   * @type {Map<number|object, { x: number, y: number }>|null}
   * @private
   */
  _initialPositions;

  /**
   * @constructor
   */
  constructor() {
    super();
    this._anchorPosition = null;
    this._initialPositions = null;
  }

  /**
   * 手势准入检测：检查 position 是否落在对象合矩形内
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean}
   */
  canBeginModifyGesture(interaction) {
    const { objects, position } = interaction;
    return this._isPositionInsideCombinedRect(objects, position);
  }

  /**
   * 记录手势锚点与各对象初始位置
   * @description
   * 锚点为手势起始光标位置（世界坐标），而非对象位置，
   * 从而保持光标与对象之间的相对偏移不变（光标拖哪，对象跟哪）。
   * @param {Object} interaction - 当前交互上下文
   */
  beginModifyGesture(interaction) {
    const { objects, position } = interaction;
    this._anchorPosition = { x: position.x, y: position.y };
    this._initialPositions = new Map(
      objects.map((obj) => [
        obj.id ?? obj,
        { x: obj.position.x, y: obj.position.y },
      ]),
    );
  }

  /**
   * 以锚点为基准计算位移，更新各对象位置
   * @param {Object} interaction - 当前交互上下文
   */
  updateModifyGesture(interaction) {
    const { objects, position } = interaction;
    if (!this._anchorPosition) return;

    const dx = position.x - this._anchorPosition.x;
    const dy = position.y - this._anchorPosition.y;

    for (const obj of objects) {
      const initPos = this._initialPositions.get(obj.id ?? obj);
      if (!initPos) continue;
      obj.position = new Vector(initPos.x + dx, initPos.y + dy);
    }
  }

  /**
   * 清空手势锚点与初始位置缓存
   * @param {Object} interaction - 当前交互上下文
   */
  completeModifyGesture(interaction) {
    this._anchorPosition = null;
    this._initialPositions = null;
  }

  /**
   * 取消手势
   * @description
   * 将对象位置回滚到手势开始时的初始位置，清空锚点与缓存。
   * 由基类 _handleCancel 在 withGeometryMutation 内调用，
   * 回滚后基层会自动触发 invalidateObjects 刷新活动层。
   * @param {Object} interaction - 当前交互上下文
   */
  cancelModifyGesture(interaction) {
    if (!this._initialPositions) return;
    for (const obj of interaction.objects) {
      const initPos = this._initialPositions.get(obj.id ?? obj);
      if (!initPos) continue;
      obj.position = new Vector(initPos.x, initPos.y);
    }
    this._anchorPosition = null;
    this._initialPositions = null;
  }

  /**
   * 重置工具状态，清除手势锚点
   * @returns {void}
   */
  reset() {
    this._anchorPosition = null;
    this._initialPositions = null;
    super.reset();
  }

  /**
   * 计算所有持有对象的合矩形范围（世界坐标）
   * @param {Array<BasicObject>} objects - 待计算对象数组
   * @returns {RectangleRange|null}
   * @private
   */
  _computeCombinedWorldRect(objects) {
    let combined = null;
    for (const obj of objects) {
      let worldRect;
      if (obj && typeof obj.getRange === "function" && obj.position) {
        const range = obj.getRange();
        if (range && typeof range.withPosition === "function") {
          worldRect = range.withPosition(obj.position);
        }
      }
      if (!worldRect) continue;
      const rect = RectangleRange.from(worldRect);
      if (!rect) continue;
      if (!combined) {
        combined = rect;
      } else {
        combined = combined.union(rect);
      }
    }
    return combined;
  }

  /**
   * 判断给定的世界坐标点是否落在对象合矩形内
   * @param {Array<BasicObject>} objects - 待检查对象数组
   * @param {{ x: number, y: number }} position - 世界坐标点
   * @returns {boolean}
   * @private
   */
  _isPositionInsideCombinedRect(objects, position) {
    const combinedRect = this._computeCombinedWorldRect(objects);
    if (!combinedRect) return true;
    return combinedRect.containsPoint(position);
  }
}

export { CommonObjectModifierTool };
