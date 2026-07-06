/**
 * @file 通用对象修改工具（手势驱动）
 * @description
 * 基于手势位置的对象修改工具。消费 position / end / success 信号，
 * 内部以手势起始位置为锚点计算位移并更新对象位置。
 * end 结束当前手势但不提交（对象仍在动态图中），success 将修改提交到静态图。
 * @module core/tools/modifier/common-object-modifier
 * @author Zhou Chenyu
 */

import {
  GestureBasedObjectModifierTool,
  OBJECT_MODIFIER_SIGNAL_TYPES,
} from "./object-modifier.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { SignalPacket } from "../../devices-dag/signal.js";

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
   * 当前手势开始时各对象的基准位置（供 updateModifyGesture 计算位移）
   * @type {Map<number|object, { x: number, y: number }>|null}
   * @private
   */
  _gestureBasePositions;

  /**
   * 首次手势开始时各对象的初始位置（永不覆盖，仅供 cancel 回退）
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
    this._gestureBasePositions = null;
    this._initialPositions = null;
  }

  /**
   * 手势准入检测：检查 position 是否落在对象合矩形内
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean}
   */
  canBeginModifyGesture(interaction) {
    const { objects, position } = interaction;
    const result = this._isPositionInsideCombinedRect(objects, position);
    return result;
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
    // 总是记录当前手势基准位置，供 updateModifyGesture 计算位移
    this._gestureBasePositions = new Map(
      objects.map((obj) => {
        const objectId = this.resolveObjectId(obj) ?? obj;
        const basePosition = this.resolveModifiedObjectPosition(obj);
        return [objectId, { x: basePosition?.x ?? 0, y: basePosition?.y ?? 0 }];
      }),
    );
    // 仅在首次手势时记录 cancel 回退用的初始位置
    if (!this._initialPositions) {
      this._initialPositions = new Map(
        objects.map((obj) => {
          const objectId = this.resolveObjectId(obj) ?? obj;
          const initialPosition = this.resolveModifiedObjectPosition(obj);
          return [
            objectId,
            { x: initialPosition?.x ?? 0, y: initialPosition?.y ?? 0 },
          ];
        }),
      );
    }
  }

  /**
   * 以锚点为基准计算位移，更新各对象位置
   * @param {Object} interaction - 当前交互上下文
   */
  updateModifyGesture(interaction) {
    const { context, objects, position } = interaction;
    if (!this._anchorPosition) return;

    const dx = position.x - this._anchorPosition.x;
    const dy = position.y - this._anchorPosition.y;

    for (const obj of objects) {
      const basePos = this._gestureBasePositions.get(
        this.resolveObjectId(obj) ?? obj,
      );
      if (!basePos) continue;
      this.setModifiedObjectPosition(context, obj, {
        x: basePos.x + dx,
        y: basePos.y + dy,
      });
    }
  }

  /**
   * 清空手势锚点与初始位置缓存
   * @param {Object} interaction - 当前交互上下文
   */
  completeModifyGesture(interaction) {
    this._anchorPosition = null;
    this._gestureBasePositions = null;
    // 保留 _initialPositions，使手势结束后的 cancel 仍能回退到首次手势的初始位置
  }

  /**
   * 位移应用前确保 _initialPositions 已记录
   * @description 当 displacement 到达且手势状态机未激活时，记录 cancel 回退用的初始位置。
   * @param {Object} interaction - 当前交互上下文
   * @override
   */
  onBeforeDisplacement(interaction) {
    if (this._initialPositions) return;
    this._initialPositions = new Map(
      interaction.objects.map((obj) => {
        const objectId = this.resolveObjectId(obj) ?? obj;
        const initialPosition = this.resolveModifiedObjectPosition(obj);
        return [
          objectId,
          { x: initialPosition?.x ?? 0, y: initialPosition?.y ?? 0 },
        ];
      }),
    );
  }

  /**
   * 位移应用后同步基准位置
   * @description displacement 应用后，将各对象基准位置也平移同样位移。
   * 锚点不动——保持光标-对象偏移不变（offset = anchor - basePos）。
   * 若调整锚点，后续 position 更新会重置偏移导致对象瞬移。
   * @param {Object} interaction - 当前交互上下文
   * @override
   */
  onAfterDisplacement(interaction) {
    if (!this._anchorPosition || !interaction.displacement) return;
    const dx = interaction.displacement.x;
    const dy = interaction.displacement.y;

    for (const basePos of this._gestureBasePositions.values()) {
      basePos.x += dx;
      basePos.y += dy;
    }
  }

  /**
   * 取消手势
   * @description
   * 将对象位置回滚到手势开始时的初始位置，清空锚点与缓存。
   * 由基类 _handleCancel 在 withGeometryMutation 内调用，
   * 回滚后基类会统一处理渲染刷新与 overlay 更新。
   * @param {Object} interaction - 当前交互上下文
   */
  cancelModifyGesture(interaction) {
    if (!this._initialPositions) return;
    for (const obj of interaction.objects) {
      const initPos = this._initialPositions.get(
        this.resolveObjectId(obj) ?? obj,
      );
      if (!initPos) continue;
      this.setModifiedObjectPosition(interaction.context, obj, {
        x: initPos.x,
        y: initPos.y,
      });
    }
    this._anchorPosition = null;
    this._gestureBasePositions = null;
    this._initialPositions = null;
  }

  /**
   * 处理一个完整信号包
   * @description 覆写基类 process，在 success 提交后清空初始位置缓存，
   * 确保下一轮新对象的 handoff 中 beginModifyGesture 能重新记录。
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, context = {}) {
    const packet = SignalPacket.from(signalPacket);
    const hasSuccess = packet.signals.some(
      (s) => s?.type === OBJECT_MODIFIER_SIGNAL_TYPES.SUCCESS,
    );

    super.process(signalPacket, context);

    // success 后提交已完成，不再需要保留开始位置用于回退
    // （cancel 已在 cancelModifyGesture 中清空 _initialPositions）
    if (hasSuccess) {
      this._initialPositions = null;
    }
  }

  /**
   * 重置工具状态，清除手势锚点与位置缓存
   * @returns {void}
   */
  reset() {
    this._anchorPosition = null;
    this._gestureBasePositions = null;
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
