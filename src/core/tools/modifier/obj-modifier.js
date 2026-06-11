/**
 * @file 对象修改工具
 * @description 提供对象几何和属性修改的基础工具实现。
 * @module core/tools/modifier/obj-modifier
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";
import { SignalPacket } from "../../devices-dag/signal.js";
import { Vector } from "../../utils/math.js";
import { BasicObject } from "../../objects/basic-obj.js";

/**
 * 对象修改工具相关信号类型常量
 * @readonly
 * @enum {string}
 */
const OBJECT_MODIFIER_SIGNAL_TYPES = Object.freeze({
  /** 世界坐标位置更新 */
  POSITION: "position",
  /** 手势结束（对象留在动态图） */
  GESTURE_END: "end",
  /** 手势取消 */
  GESTURE_CANCEL: "cancel",
  /** 将修改提交到静态图 */
  SUCCESS: "success",
});

/**
 * 对象修改工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 对象修改工具负责改变已有对象的几何形态、样式或其它可编辑属性。
 */
class ObjectModifierTool extends Tool {
  /**
   * 收集 modifier 当前声明的兼容 ui overlay。
   * @param {{ deviceContext?: Object, renderer?: Object }} [overlayContext={}]
   * @returns {Array<Object>}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    const deviceContext = overlayContext.deviceContext ?? {};
    const renderer = overlayContext.renderer;
    const objects = this.resolveContextObjects(deviceContext).filter(Boolean);

    if (
      objects.length === 0 ||
      typeof renderer?.createCompatSelectionEntriesForObjects !== "function"
    ) {
      return [];
    }

    return renderer.createCompatSelectionEntriesForObjects(objects, "modifier");
  }

  /**
   * 规整本次修改涉及的对象集合
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   * @returns {Array<BasicObject>}
   */
  resolveModifiedObjects(modificationContext, objects) {
    if (objects == null) {
      return this.resolveContextObjects(modificationContext);
    }

    return this.normalizeObjectCollection(objects);
  }

  /**
   * 解析当前仍处于 AOM 动态图中的对象集合
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   * @returns {Array<BasicObject>}
   */
  resolveActiveModifiedObjects(modificationContext, objects) {
    const normalizedObjects = this.resolveModifiedObjects(
      modificationContext,
      objects,
    );
    const activeObjectIndex =
      modificationContext?.context?.board?.activeObjectManager
        ?.activeObjectIndex;

    if (typeof activeObjectIndex?.has !== "function") {
      return normalizedObjects;
    }

    return normalizedObjects.filter(
      (objectEntry) => objectEntry && activeObjectIndex.has(objectEntry.id),
    );
  }

  /**
   * 在对象几何修改前记录旧快照。
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   */
  beforeGeometryMutation(modificationContext, objects) {
    const normalizedObjects = this.resolveModifiedObjects(
      modificationContext,
      objects,
    );

    if (normalizedObjects.length === 0) return;

    modificationContext?.context?.monitor?.liveRenderer?.captureObjectSnapshot?.(
      normalizedObjects,
    );
  }

  /**
   * 在对象几何修改后请求活动层刷新。
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   */
  afterGeometryMutation(modificationContext, objects) {
    const normalizedObjects = this.resolveModifiedObjects(
      modificationContext,
      objects,
    );

    if (normalizedObjects.length === 0) return;

    modificationContext?.context?.monitor?.liveRenderer?.invalidateObjects?.(
      normalizedObjects,
    );
    modificationContext?.context?.monitor?.requestViewportUiRender?.();
  }

  /**
   * 以统一的快照协议包装一次几何修改。
   * @param {Object} modificationContext - 修改上下文
   * @param {Function} mutate - 实际执行修改的回调
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   * @returns {*}
   */
  withGeometryMutation(modificationContext, mutate, objects) {
    const normalizedObjects = this.resolveModifiedObjects(
      modificationContext,
      objects,
    );

    this.beforeGeometryMutation(modificationContext, normalizedObjects);
    const result = mutate?.();
    this.afterGeometryMutation(modificationContext, normalizedObjects);

    return result;
  }

  /**
   * 决定是否执行 apply。
   * @param {Object} modificationContext - 修改上下文
   * @param {Array<BasicObject>} objects - 已解析的活动对象
   * @returns {boolean}
   * @protected
   */
  beforeApplyModifiedObjects(modificationContext, objects) {
    return true;
  }

  /**
   * 提交成功后的通知钩子。
   * handoff 通过 {@link Tool#on|on('afterApply', ...)} 订阅。
   * @param {Object} modificationContext - 修改上下文
   * @param {Array<BasicObject>} objects - 已提交的对象
   * @param {boolean} result - 提交结果
   * @protected
   */
  afterApplyModifiedObjects(modificationContext, objects, result) {
    this._emit("afterApply", modificationContext, objects, result);
  }

  /**
   * 将当前修改对象提交回静态图。
   * @param {Object} modificationContext - 修改上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   * @returns {boolean}
   */
  applyModifiedObjects(modificationContext, objects) {
    const normalizedObjects = this.resolveActiveModifiedObjects(
      modificationContext,
      objects,
    );

    if (normalizedObjects.length === 0) {
      this.clearContextObjects(modificationContext);
      return false;
    }

    if (
      this.beforeApplyModifiedObjects(
        modificationContext,
        normalizedObjects,
      ) === false
    ) {
      return false;
    }

    modificationContext?.context?.board?.activeObjectManager?.apply?.(
      new Set(normalizedObjects),
    );
    this.clearContextObjects(modificationContext);

    const autoUmount = modificationContext.context?.autoUmountOnApply !== false;
    if (
      autoUmount &&
      typeof modificationContext.dag?.unmount === "function" &&
      typeof modificationContext.path === "string"
    ) {
      modificationContext.dag.unmount(modificationContext.path);
    }

    this.afterApplyModifiedObjects(
      modificationContext,
      normalizedObjects,
      true,
    );
    return true;
  }

  /**
   * 在修改工具被卸载时撤销未提交的活动对象引用。
   * @param {Object} [modificationContext={}] - 修改上下文
   * @returns {void}
   */
  umount(modificationContext = {}) {
    const normalizedObjects =
      this.resolveActiveModifiedObjects(modificationContext);

    if (normalizedObjects.length > 0) {
      modificationContext?.context?.board?.activeObjectManager?.discard?.(
        new Set(normalizedObjects),
      );
    }

    this.clearContextObjects(modificationContext);
    super.umount(modificationContext);
  }
}

/**
 * 手势驱动对象修改工具
 * @class
 * @abstract
 * @extends ObjectModifierTool
 * @description
 * 内置手势生命周期的对象修改工具。消费 position 信号（而非 displacement），
 * 子类只需覆写手势 hook 即可实现具体修改逻辑，无需关心 process() 调度细节。
 *
 * 手势模型：
 * 1. position 信号到达 → 手势开始（beginModifyGesture）或持续更新（updateModifyGesture）
 * 2. end 信号 → 手势结束（completeModifyGesture），对象保留在 AOM 动态图中
 * 3. success 信号 → 提交到静态图（applyModifiedObjects）
 * 4. cancel 信号 → 取消当前手势（cancelModifyGesture），对象不回滚，仅停止接收后续位置更新
 *
 * 该工具直接使用世界坐标 position 驱动，无需前置 prefix 计算位移。
 * 子类可在 hook 内自行计算增量并更新对象几何。
 *
 * @author Zhou Chenyu
 */
class GestureBasedObjectModifierTool extends ObjectModifierTool {
  /**
   * 当前修改手势是否激活
   * @type {boolean}
   */
  isModifyingGestureActive;

  constructor() {
    super();
    this.isModifyingGestureActive = false;
  }

  /**
   * 从信号包中提取世界坐标位置。
   * 优先通过 deviceContext.resolvePosition 解析，否则从 position 信号中读取。
   * 所有路径的结果都会经过 Vector.parse 归一化为 Vector。
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {Vector|null}
   * @protected
   */
  _extractPosition(signalPacket, deviceContext) {
    if (typeof deviceContext.resolvePosition === "function") {
      const resolved = deviceContext.resolvePosition(signalPacket);
      if (resolved) return Vector.parse(resolved);
    }
    const positionSignal = signalPacket.signals.find(
      (s) => s.type === OBJECT_MODIFIER_SIGNAL_TYPES.POSITION,
    );
    if (!positionSignal) return null;
    const raw =
      positionSignal?.context?.value ?? positionSignal?.context?.position;
    return Vector.parse(raw);
  }

  /**
   * 构造扁平的修改上下文。
   * 将 deviceContext 的嵌套 context 提升到顶层，使基类方法能通过
   * modificationContext.context.board / .monitor 访问运行时依赖。
   * 若 deviceContext 未提供 context 属性，则创建空 context，
   * 基类方法通过可选链安全访问，不会报错。
   * @param {Object} deviceContext - 设备上下文
   * @returns {Object}
   * @private
   */
  _buildModificationContext(deviceContext = {}) {
    return {
      ...deviceContext,
      context: {
        ...(deviceContext?.context ?? {}),
      },
    };
  }

  /**
   * 从信号包中提取修改交互上下文
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @param {Array<*>} objects - 当前活动的修改对象
   * @returns {Object} 交互上下文
   * @protected
   */
  buildModifyInteractionContext(
    signalPacket,
    deviceContext = {},
    objects = [],
  ) {
    const signals = signalPacket.signals;
    return {
      signalPacket,
      deviceContext,
      signals,
      position: this._extractPosition(signalPacket, deviceContext),
      objects,
      hasEndSignal: signals.some(
        (s) => s.type === OBJECT_MODIFIER_SIGNAL_TYPES.GESTURE_END,
      ),
      hasCancelSignal: signals.some(
        (s) => s.type === OBJECT_MODIFIER_SIGNAL_TYPES.GESTURE_CANCEL,
      ),
      hasSuccessSignal: signals.some(
        (s) => s.type === OBJECT_MODIFIER_SIGNAL_TYPES.SUCCESS,
      ),
    };
  }

  /**
   * 处理信号包（手势驱动）
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);
    const modificationContext = this._buildModificationContext(deviceContext);

    const objects = this.resolveActiveModifiedObjects(modificationContext);
    if (objects.length === 0) return;

    this.setContextObjects(modificationContext, objects);
    const interaction = this.buildModifyInteractionContext(
      packet,
      deviceContext,
      objects,
    );

    if (interaction.hasCancelSignal) {
      this._handleCancel(interaction);
      return;
    }

    if (interaction.hasSuccessSignal) {
      this._handleSuccess(interaction, modificationContext, objects);
      return;
    }

    if (!interaction.position) {
      this._handleOrphanEnd(interaction);
      return;
    }

    this._handlePositionUpdate(interaction, modificationContext, objects);
  }

  /**
   * 处理 cancel 信号：取消当前手势。
   * 注意：cancel 仅停止接收后续位置更新，对象保持在最后修改的位置，不会回滚。
   * @param {Object} interaction - 当前交互上下文
   * @private
   */
  _handleCancel(interaction) {
    if (this.isModifyingGestureActive) {
      this.cancelModifyGesture(interaction);
      this.isModifyingGestureActive = false;
    }
  }

  /**
   * 处理 success 信号：结束手势并提交修改到静态图。
   * @param {Object} interaction - 当前交互上下文
   * @param {Object} modificationContext - 修改上下文
   * @param {Array<*>} objects - 活动对象
   * @private
   */
  _handleSuccess(interaction, modificationContext, objects) {
    if (this.isModifyingGestureActive) {
      this.completeModifyGesture(interaction);
      this.isModifyingGestureActive = false;
    }
    this.applyModifiedObjects(modificationContext, objects);
  }

  /**
   * 处理无位置信号时孤立的 end 信号。
   * @param {Object} interaction - 当前交互上下文
   * @private
   */
  _handleOrphanEnd(interaction) {
    if (interaction.hasEndSignal && this.isModifyingGestureActive) {
      this.completeModifyGesture(interaction);
      this.isModifyingGestureActive = false;
    }
  }

  /**
   * 处理位置更新：首次启动手势或持续更新对象位置。
   * @param {Object} interaction - 当前交互上下文
   * @param {Object} modificationContext - 修改上下文
   * @param {Array<*>} objects - 活动对象
   * @private
   */
  _handlePositionUpdate(interaction, modificationContext, objects) {
    if (!this.isModifyingGestureActive) {
      // 首次位置：准入检测 → begin + update
      if (this.canBeginModifyGesture(interaction) === false) return;
      this.withGeometryMutation(
        modificationContext,
        () => {
          this.beginModifyGesture(interaction);
          this.updateModifyGesture(interaction);
        },
        objects,
      );
      this.isModifyingGestureActive = true;
    } else {
      // 后续位置：仅 update
      this.withGeometryMutation(
        modificationContext,
        () => {
          this.updateModifyGesture(interaction);
        },
        objects,
      );
    }

    // 同一信号包中附带的 end 信号。
    // completeModifyGesture 仅做状态清理，不修改几何，因此不包裹 withGeometryMutation。
    if (interaction.hasEndSignal) {
      this.completeModifyGesture(interaction);
      this.isModifyingGestureActive = false;
    }
  }

  /**
   * 手势准入检查，决定是否允许开始修改手势。
   * 子类可覆写以添加区域命中检测等限制。
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean}
   * @protected
   */
  canBeginModifyGesture(interaction) {
    return true;
  }

  /**
   * 修改手势开始
   * @param {Object} interaction - 当前交互上下文
   * @abstract
   */
  beginModifyGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 修改手势更新
   * @param {Object} interaction - 当前交互上下文
   * @abstract
   */
  updateModifyGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 修改手势完成
   * @param {Object} interaction - 当前交互上下文
   */
  completeModifyGesture(interaction) {}

  /**
   * 修改手势取消。
   * 对象不会回滚到初始状态，仅停止接收后续位置更新。
   * @param {Object} interaction - 当前交互上下文
   */
  cancelModifyGesture(interaction) {}

  /**
   * 工具节点被卸载时清理手势状态
   * @param {Object} [modificationContext={}] - 卸载时的修改上下文
   * @returns {void}
   */
  umount(modificationContext = {}) {
    this.isModifyingGestureActive = false;
    super.umount(modificationContext);
  }

  /**
   * 重置工具状态，清除当前手势
   * @returns {void}
   */
  reset() {
    this.isModifyingGestureActive = false;
  }
}

export {
  OBJECT_MODIFIER_SIGNAL_TYPES,
  ObjectModifierTool,
  GestureBasedObjectModifierTool,
};
