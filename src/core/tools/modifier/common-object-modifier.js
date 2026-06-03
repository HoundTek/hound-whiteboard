/**
 * @file 通用对象修改工具（手势驱动）
 * @description
 * 基于手势位移的对象修改工具。与 creator 工具采用相同的手势模型：
 * 接收 displacement / end / success 信号，displacement 信号携带从手势锚点
 * 出发的累计位移 {x, y}，modifier 直接以 initPos + {x, y} 更新对象位置。
 * end 结束当前手势但不提交（对象仍在动态图中），success 将修改提交到静态图。
 * @module core/tools/modifier/common-object-modifier
 * @author Zhou Chenyu
 */

import { Vector } from "../../utils/math.js";
import { SignalPacket } from "../../devices-dag/signal.js";
import {
  ObjectModifierTool,
  OBJECT_MODIFIER_SIGNAL_TYPES,
} from "./obj-modifier.js";

/**
 * 通用对象修改工具类
 *
 * @class
 * @extends ObjectModifierTool
 * @description
 * 手势驱动的对象位置修改工具，适用于所有对象类型。
 *
 * 手势生命周期：
 * 1. 首个 displacement 信号 → 手势开始，记录对象初始位置，位移应用
 * 2. 后续 displacement 信号 → 直接以 initPos + {x, y} 更新对象
 * 3. end 信号 → 手势结束，清空锚点状态，但对象保留在动态图中
 * 4. success 信号 → 将修改后的对象提交到静态图，结束修改流程
 *
 * 该工具消费来自 drag-anchor 前缀处理器的 "displacement" 信号，
 * 信号携带从手势锚点出发的累计位移 {x, y}，无需内部累加。
 *
 * @author Zhou Chenyu
 */
class CommonObjectModifierTool extends ObjectModifierTool {
  constructor() {
    super();
    /** @type {boolean} 当前手势是否激活 */
    this._isGestureActive = false;
    /** @type {Map<*, { x: number, y: number }>|null} 手势开始时各对象的初始位置 */
    this._initialPositions = null;
  }

  /**
   * 处理信号包
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);

    const displacementSignal = packet.signals.find(
      (signal) => signal.type === "displacement",
    );
    const hasEndSignal = packet.signals.some(
      (signal) => signal.type === "end",
    );
    const hasSuccessSignal = packet.signals.some(
      (signal) => signal.type === OBJECT_MODIFIER_SIGNAL_TYPES.SUCCESS,
    );

    const modificationContext = {
      ...deviceContext,
      objects:
        deviceContext.objects ??
        (deviceContext.object ? [deviceContext.object] : undefined) ??
        this.resolveContextObjects(deviceContext),
    };

    const objects = this.resolveActiveModifiedObjects(modificationContext);
    if (objects.length === 0) {
      return;
    }

    this.setContextObjects(modificationContext, objects);

    const rawDisplacement =
      displacementSignal?.context?.value ?? displacementSignal?.context;
    const displacement = this._normalizeDisplacement(rawDisplacement);

    // 处理 displacement 信号 —— 手势位移
    if (displacementSignal && !hasSuccessSignal && displacement) {
      if (!this._isGestureActive) {
        // 手势开始：记录各对象的初始位置
        this._isGestureActive = true;
        this._initialPositions = new Map(
          objects.map((obj) => [
            obj.id ?? obj,
            { x: obj.position.x, y: obj.position.y },
          ]),
        );
      }

      this.withGeometryMutation(
        modificationContext,
        () => {
          for (const obj of objects) {
            const initPos = this._initialPositions.get(obj.id ?? obj);
            if (!initPos) continue;
            obj.position = new Vector(
              initPos.x + displacement.x,
              initPos.y + displacement.y,
            );
          }
        },
        objects,
      );
    }

    // 处理 end 信号 —— 手势结束，对象保留在动态图中
    if (hasEndSignal) {
      this._endGesture();
    }

    // 处理 success 信号 —— 提交到静态图
    if (hasSuccessSignal) {
      this._endGesture();
      this.applyModifiedObjects(modificationContext, objects);
      return undefined;
    }
  }

  /**
   * 重置工具状态
   * @returns {void}
   */
  reset() {
    this._endGesture();
  }

  /**
   * 结束当前手势，清空内部状态
   * @returns {void}
   * @private
   */
  _endGesture() {
    this._isGestureActive = false;
    this._initialPositions = null;
  }

  /**
   * 将信号上下文中的位移规整为 { x, y }
   * @param {*} value - 原始值
   * @returns {{ x: number, y: number }|null}
   * @private
   */
  _normalizeDisplacement(value) {
    if (!value) return null;
    if (typeof value.x === "number" && typeof value.y === "number") {
      return { x: value.x, y: value.y };
    }
    return null;
  }
}

export { CommonObjectModifierTool };
