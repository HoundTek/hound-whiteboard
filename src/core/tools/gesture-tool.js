/**
 * @file 手势工具基类
 * @description 定义单手势与多手势工具共享的手势/动作生命周期骨架。
 * @module core/tools/gesture-tool
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../devices-dag/signal.js";
import { Vector } from "../utils/math.js";
import { Tool } from "./tool.js";

/**
 * 手势工具相关信号类型常量
 * @readonly
 * @enum {string}
 */
const GESTURE_TOOL_SIGNAL_TYPES = Object.freeze({
  /** 世界坐标位置更新 */
  POSITION: "position",
  /** 手势结束 */
  GESTURE_END: "end",
  /** 手势取消 */
  GESTURE_CANCEL: "cancel",
  /** 多手势对象结束 */
  OBJECT_END: "object-end",
  /** 多手势对象取消 */
  OBJECT_CANCEL: "object-cancel",
  /** 显式提交动作 */
  SUCCESS: "success",
});

/**
 * 手势交互上下文
 * @typedef {Object} GestureInteraction
 * @property {SignalPacket} signalPacket - 输入信号包
 * @property {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
 * @property {Array<{type: string, context?: *}>} signals - 规整后的信号列表
 * @property {Vector|null} position - 当前世界坐标位置
 * @property {boolean} hasCancel - 是否包含 cancel 信号
 * @property {boolean} hasEnd - 是否包含 end 信号
 * @property {boolean} hasObjectCancel - 是否包含 object-cancel 信号
 * @property {boolean} hasObjectEnd - 是否包含 object-end 信号
 * @property {boolean} hasSuccess - 是否包含 success 信号
 */

/**
 * 单手势工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * GestureTool 将工具交互分为两层：
 * 1. 手势生命周期：`beginGesture → updateGesture → completeGesture/cancelGesture`
 * 2. 动作生命周期：`beforeAction → performAction → afterAction`
 *
 * 默认采用单手势语义：
 * - `end` → 结束当前手势，按 `autoActionOnGestureEnd` 决定是否自动触发 `completeAction`
 * - `cancel` → 取消当前手势，并调用 `discardAction` 丢弃当前对象/状态
 * - `success` → 显式完成动作
 *
 * 多手势语义通过 {@link MultiGestureTool} 覆写 `_onEnd/_onCancel/_onObjectEnd/_onObjectCancel`
 * 四个分派方法实现。
 */
class GestureTool extends Tool {
  /**
   * 当前手势是否激活
   * @type {boolean}
   */
  isGestureActive;

  /**
   * 收到 end 信号时是否自动触发 completeAction
   * @type {boolean}
   */
  autoActionOnGestureEnd;

  constructor() {
    super();
    this.isGestureActive = false;
    this.autoActionOnGestureEnd = true;
  }

  /**
   * 从信号包中提取世界坐标位置
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {Vector|null} 规整后的世界坐标
   * @protected
   */
  _extractPosition(signalPacket, context = {}) {
    if (typeof context.resolvePosition === "function") {
      const resolved = context.resolvePosition(signalPacket);
      if (resolved) {
        return Vector.parse(resolved);
      }
    }

    const positionSignal = signalPacket.signals.find(
      (signal) => signal.type === GESTURE_TOOL_SIGNAL_TYPES.POSITION,
    );
    const rawPosition =
      positionSignal?.context?.value ?? positionSignal?.context?.position;
    return Vector.parse(rawPosition);
  }

  /**
   * 构建统一的手势交互上下文
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {GestureInteraction}
   */
  buildInteraction(signalPacket, context = {}) {
    const signals = signalPacket.signals ?? [];
    return {
      signalPacket,
      context,
      signals,
      position: this._extractPosition(signalPacket, context),
      hasCancel: signals.some(
        (signal) => signal?.type === GESTURE_TOOL_SIGNAL_TYPES.GESTURE_CANCEL,
      ),
      hasEnd: signals.some(
        (signal) => signal?.type === GESTURE_TOOL_SIGNAL_TYPES.GESTURE_END,
      ),
      hasObjectCancel: signals.some(
        (signal) => signal?.type === GESTURE_TOOL_SIGNAL_TYPES.OBJECT_CANCEL,
      ),
      hasObjectEnd: signals.some(
        (signal) => signal?.type === GESTURE_TOOL_SIGNAL_TYPES.OBJECT_END,
      ),
      hasSuccess: signals.some(
        (signal) => signal?.type === GESTURE_TOOL_SIGNAL_TYPES.SUCCESS,
      ),
    };
  }

  /**
   * 手势开始前的准入检测
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {boolean}
   * @protected
   */
  canBeginGesture(interaction) {
    return true;
  }

  /**
   * 确保当前手势拥有可操作对象
   * @description Creator 可覆写此方法做 objectId 分配与草稿创建。
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {boolean}
   * @protected
   */
  _ensureObject(interaction) {
    return true;
  }

  /**
   * 手势开始钩子
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @abstract
   */
  beginGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 手势更新钩子
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @abstract
   */
  updateGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 手势完成钩子
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   */
  completeGesture(interaction) {}

  /**
   * 手势取消钩子
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   */
  cancelGesture(interaction) {}

  /**
   * 动作执行前的控制流钩子
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {boolean}
   * @protected
   */
  beforeAction(context) {
    return true;
  }

  /**
   * 执行动作
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {*} 动作结果
   * @abstract
   */
  performAction(context) {
    throw new Error("Method not implemented.");
  }

  /**
   * 动作完成后的通知钩子
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {*} result - 动作结果
   * @returns {void}
   * @protected
   */
  afterAction(context, result) {
    this._emit("action:complete", context, result);
  }

  /**
   * 丢弃当前动作持有的对象或状态
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   * @protected
   */
  discardAction(context) {}

  /**
   * 清理当前工具维护的 overlay 临时状态
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   * @protected
   */
  clearOverlayState(context = {}) {}

  /**
   * 编排完整的动作提交流程
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {*} 动作结果
   */
  completeAction(context) {
    if (this.beforeAction(context) === false) {
      return false;
    }

    const result = this.performAction(context);
    if (result instanceof Promise) {
      return result.then((resolvedResult) => {
        this.afterAction(context, resolvedResult);
        return resolvedResult;
      });
    }

    this.afterAction(context, result);
    return result;
  }

  /**
   * 处理 cancel 信号（单手势默认语义）
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _onCancel(interaction) {
    if (this.isGestureActive) {
      this.cancelGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:cancel", interaction);
    }

    this.clearOverlayState(interaction.context);
    return this.discardAction(interaction.context);
  }

  /**
   * 处理 end 信号（单手势默认语义）
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _onEnd(interaction) {
    if (this.isGestureActive) {
      this.completeGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:end", interaction);
    }

    if (this.autoActionOnGestureEnd) {
      this.clearOverlayState(interaction.context);
      return this.completeAction(interaction.context);
    }

    return undefined;
  }

  /**
   * 处理 object-end 信号
   * @description 单手势模式下等同于 `_onEnd`。
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _onObjectEnd(interaction) {
    return this._onEnd(interaction);
  }

  /**
   * 处理 object-cancel 信号
   * @description 单手势模式下等同于 `_onCancel`。
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _onObjectCancel(interaction) {
    return this._onCancel(interaction);
  }

  /**
   * 处理 success 信号
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _onSuccess(interaction) {
    if (this.isGestureActive) {
      this.completeGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:end", interaction);
    }

    this.clearOverlayState(interaction.context);
    return this.completeAction(interaction.context);
  }

  /**
   * 处理空间更新（position 通道）
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _handleSpatialUpdate(interaction) {
    if (!interaction.position) {
      return;
    }

    if (!this.isGestureActive) {
      if (this.canBeginGesture(interaction) === false) {
        return;
      }
      if (this._ensureObject(interaction) === false) {
        return;
      }

      this.beginGesture(interaction);
      this.isGestureActive = true;
      this._emit("gesture:begin", interaction);
    }

    this.updateGesture(interaction);
    this._emit("gesture:update", interaction);
  }

  /**
   * 处理一个完整信号包
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, context = {}) {
    const packet = SignalPacket.from(signalPacket);
    const interaction = this.buildInteraction(packet, context);

    if (interaction.hasObjectCancel) {
      return this._onObjectCancel(interaction);
    }

    if (interaction.hasCancel) {
      return this._onCancel(interaction);
    }

    if (interaction.hasObjectEnd) {
      return this._onObjectEnd(interaction);
    }

    if (interaction.hasSuccess) {
      return this._onSuccess(interaction);
    }

    this._handleSpatialUpdate(interaction);

    if (interaction.hasEnd) {
      return this._onEnd(interaction);
    }

    return undefined;
  }

  /**
   * 重置手势运行时状态
   * @returns {void}
   */
  reset() {
    this.isGestureActive = false;
  }
}

/**
 * 多手势工具基类
 * @class
 * @abstract
 * @extends GestureTool
 * @description
 * MultiGestureTool 将 `end/cancel` 解释为“当前手势完成/取消”，
 * 仅在 `object-end/object-cancel` 到达时才提交或丢弃整个对象动作。
 */
class MultiGestureTool extends GestureTool {
  /**
   * 处理 end 信号（多手势语义）
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _onEnd(interaction) {
    if (!this.isGestureActive) {
      return;
    }

    this.completeGesture(interaction);
    this.isGestureActive = false;
    this._emit("gesture:end", interaction);
  }

  /**
   * 处理 cancel 信号（多手势语义）
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _onCancel(interaction) {
    if (!this.isGestureActive) {
      return;
    }

    this.cancelGesture(interaction);
    this.isGestureActive = false;
    this._emit("gesture:cancel", interaction);
  }

  /**
   * 处理 object-end 信号（多手势语义）
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _onObjectEnd(interaction) {
    if (this.isGestureActive) {
      this.completeGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:end", interaction);
    }

    this.clearOverlayState(interaction.context);
    return this.completeAction(interaction.context);
  }

  /**
   * 处理 object-cancel 信号（多手势语义）
   * @param {GestureInteraction} interaction - 当前手势交互上下文
   * @returns {void}
   * @protected
   */
  _onObjectCancel(interaction) {
    if (this.isGestureActive) {
      this.cancelGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:cancel", interaction);
    }

    this.clearOverlayState(interaction.context);
    return this.discardAction(interaction.context);
  }
}

export { GESTURE_TOOL_SIGNAL_TYPES, GestureTool, MultiGestureTool };
