/**
 * @file 通用对象修改工具（数据侧）
 * @description
 * 通用对象修改的数据侧工具：负责合矩形准入检测与 processor 装配，
 * 拖拽手势状态机由必传的 DragGestureProcessor 承担。
 * end 结束当前手势但不提交（对象仍在动态图中），success 将修改提交到静态图。
 * @module core/ui-thread/devices-dag/tools/modifier/common-object-modifier
 * @author Zhou Chenyu
 */

import { GestureBasedObjectModifierTool } from "./object-modifier.js";
import { BasicObject } from "../../../../engine/objects/basic-obj.js";

/**
 * 通用对象修改工具类
 *
 * @class
 * @extends GestureBasedObjectModifierTool
 * @description
 * 数据侧工具：准入检测 + processor 装配，适用于所有对象类型的拖拽移动。
 * 手势（锚点 / 基准位置 / 初始位置回滚）由必传的 DragGestureProcessor 承担，
 * 本类只保留合矩形准入检测这一数据侧职责。
 *
 * 手势生命周期（由基类 GestureBasedObjectModifierTool 编排、processor 执行）：
 * 1. 首个 position 信号 → canBeginGesture 准入检测 → processor.begin 记录锚点
 * 2. 后续 position 信号 → processor.update 以锚点为基准更新对象位置
 * 3. end 信号 → processor.complete 清空锚点，对象留在动态图
 * 4. cancel 信号 → processor.cancel 将对象回滚到手势初始位置
 * 5. success 信号 → 对象提交到静态图
 *
 * @author Zhou Chenyu
 */
class CommonObjectModifierTool extends GestureBasedObjectModifierTool {
  /**
   * @param {{
   *   processor: import("./gesture/drag-processor.js").DragGestureProcessor,
   * }} options - 配置选项（processor 必传）
   * @constructor
   */
  constructor(options) {
    super(options);
  }

  /**
   * 手势准入检测：检查 position 是否落在对象合矩形内
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean}
   */
  canBeginGesture(interaction) {
    const { objects, position } = interaction;
    const result = this._isPositionInsideCombinedRect(objects, position);
    return result;
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
      const rect = this.resolveModifiedObjectWorldRect(obj);
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
    if (!combinedRect) {
      return true;
    }
    const inside = combinedRect.containsPoint(position);
    return inside;
  }
}

export { CommonObjectModifierTool };
