/**
 * @file 对象创建工具
 * @description 提供对象创建流程与信号类型定义的工具基类。
 * @module core/tools/creator/obj-creator
 * @author Zhou Chenyu
 */

import { Vector } from "../../utils/math.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { SignalPacket } from "../../devices-dag/signal.js";
import { Tool } from "../tool.js";

/**
 * 对象创建工具相关信号类型常量
 * @readonly
 * @enum {string}
 * @description
 * 定义对象创建工具处理的信号类型，包括位置更新、手势结束/取消、对象结束/取消等。
 * 这些信号类型用于工具在处理输入时识别不同的交互阶段和事件。
 * @author Zhou Chenyu
 */
const OBJECT_CREATOR_SIGNAL_TYPES = Object.freeze({
  POSITION: "position",
  PROPERTY: "property",
  GESTURE_END: "end",
  GESTURE_CANCEL: "cancel",
  OBJECT_END: "object-end",
  OBJECT_CANCEL: "object-cancel",
  END: "end",
  CANCEL: "cancel",
});

/**
 * 从信号列表中提取 prefix 注入的对象属性
 * @param {Array<Object>} signals
 * @returns {Record<string, any>|null}
 */
function extractInjectedProperty(signals) {
  const propertySignal = signals.find(
    (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.PROPERTY,
  );
  const value = propertySignal?.context?.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : null;
}

/**
 * 对象创建工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 对象创建工具是用于在白板上创建各种对象的工具的基类。
 * 具体的对象创建工具应继承此类并实现其特定功能。
 * 例如，矩形创建工具用于创建矩形对象，圆形创建工具用于创建圆形对象等。
 * 这些工具通常允许用户通过点击和拖动来定义对象的位置和大小。
 * @author Zhou Chenyu
 */
class ObjectCreatorTool extends Tool {
  /**
   * @constructor
   */
  constructor() {
    super();
    this.isCreatingGestureActive = false;
    this.isObjectCreationCompleted = false;
    this._pendingProperty = null;
  }

  /**
   * 解析序列化的对象生成工具数据以创建工具实例
   * @static
   * @abstract
   * @param {Object} toolData - 序列化的工具数据
   * @returns {ObjectCreatorTool} 创建的对象生成工具实例
   */
  static parse(toolData) {
    throw new Error("Method not implemented.");
  }

  /**
   * 序列化对象生成工具实例以保存工具数据
   * @abstract
   * @return {Object} 序列化后的对象生成工具数据
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 当前正在创建的对象
   * @type {BasicObject}
   */
  obj;

  /**
   * 当前创建手势是否仍在持续
   * @type {boolean}
   */
  isCreatingGestureActive;

  /**
   * 当前对象是否已经完成提交
   * @type {boolean}
   */
  isObjectCreationCompleted;

  /**
   * 从信号包中提取的注入属性
   * @type {Record<string, any>|null}
   */
  _pendingProperty;

  /**
   * 从信号包中提取交互上下文
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {Object} 交互上下文
   */
  buildInteractionContext(signalPacket, deviceContext = {}) {
    const signals = signalPacket.signals;
    const positionSignal = signals.find(
      (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
    );
    const position =
      deviceContext.resolvePosition?.(signalPacket) ??
      Vector.parse(
        positionSignal?.context?.value ?? positionSignal?.context?.position,
      );
    return {
      signalPacket,
      deviceContext,
      signals,
      position,
      isGestureEnded: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.GESTURE_END,
      ),
      isGestureCancelled: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.GESTURE_CANCEL,
      ),
      isObjectEnded: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END,
      ),
      isObjectCancelled: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_CANCEL,
      ),
      objectId: positionSignal?.context?.objectId ?? deviceContext.objectId,
      ownerChunkId:
        positionSignal?.context?.ownerChunkId ??
        deviceContext.ownerChunkId ??
        deviceContext.context?.resolveOwnerChunkId?.(position, signalPacket),
      injectedProperty: extractInjectedProperty(signals),
    };
  }

  /**
   * 确保当前交互已拥有对象实例
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean} 是否已拥有对象实例
   */
  ensureObject(interaction) {
    if (!this.obj || this.isObjectCreationCompleted) {
      this._pendingProperty = interaction?.injectedProperty ?? null;
      const objectId =
        interaction.objectId ??
        interaction?.deviceContext?.context?.allocateObjectId?.();
      if (interaction.objectId == null || interaction.ownerChunkId == null) {
        if (objectId == null || interaction.ownerChunkId == null) {
          return false;
        }
      }
      interaction.objectId = objectId;
      this.create(interaction.position, objectId, interaction.ownerChunkId);
      if (
        this._pendingProperty &&
        this.obj &&
        typeof this.obj.setProperty === "function"
      ) {
        this.obj.setProperty(this._pendingProperty);
      }
      this._pendingProperty = null;
      this.isObjectCreationCompleted = false;
      this.syncCreatedObjectContext(interaction?.deviceContext);
      interaction?.deviceContext?.context?.board?.activeObjectManager?.add?.(
        new Set([this.obj]),
      );
    }

    return true;
  }

  /**
   * 将当前创建对象写回上下文
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {BasicObject} [objectEntry=this.obj] - 当前对象
   * @returns {Array<BasicObject>}
   */
  syncCreatedObjectContext(deviceContext = {}, objectEntry = this.obj) {
    return this.setContextObjects(
      deviceContext,
      objectEntry ? [objectEntry] : [],
    );
  }

  /**
   * 卸载或结束 workflow 时撤销未提交对象
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {void}
   */
  discardCreatedObjects(deviceContext = {}) {
    const normalizedObjects =
      this.resolveContextObjects(deviceContext).filter(Boolean);
    const activeObjectIndex =
      deviceContext?.context?.board?.activeObjectManager?.activeObjectIndex;
    const activeObjects =
      typeof activeObjectIndex?.has === "function"
        ? normalizedObjects.filter((objectEntry) =>
            activeObjectIndex.has(objectEntry.id),
          )
        : normalizedObjects;

    if (activeObjects.length > 0) {
      deviceContext?.context?.board?.activeObjectManager?.discard?.(
        new Set(activeObjects),
      );
    }
  }

  /**
   * 处理一个完整信号包
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   * @abstract
   */
  process(signalPacket, deviceContext = {}) {
    throw new Error("Method not implemented.");
  }

  /**
   * 开始一次创建手势
   * @param {Object} interaction - 当前交互上下文
   */
  beginCreationGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 在对象几何变更前记录旧快照
   * @param {Object} interaction - 当前交互上下文
   */
  beforeGeometryMutation(interaction) {
    if (!this.obj) return;
    interaction?.deviceContext?.context?.monitor?.liveRenderer?.captureObjectSnapshot?.(
      [this.obj],
    );
  }

  /**
   * 在对象几何变更后请求活动层刷新
   * @param {Object} interaction - 当前交互上下文
   */
  afterGeometryMutation(interaction) {
    if (!this.obj) return;
    interaction?.deviceContext?.context?.monitor?.liveRenderer?.invalidateObjects?.(
      [this.obj],
    );
    interaction?.deviceContext?.context?.monitor?.requestViewportUiRender?.();
  }

  /**
   * 更新一次创建手势
   * @param {Object} interaction - 当前交互上下文
   */
  updateCreationGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 完成一次创建手势
   * @param {Object} interaction - 当前交互上下文
   */
  completeCreationGesture(interaction) {
    return undefined;
  }

  /**
   * 取消当前创建手势
   * @param {Object} interaction - 当前交互上下文
   */
  cancelCreationGesture(interaction) {
    return undefined;
  }

  /**
   * 决定 finalize 之后是否将对象提交到静态图。
   * handoff 工作流 override 此钩子返回 false 以阻止提交，
   * 使对象停留在 AOM 动态图中等待 modifier 最终提交。
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean}
   * @protected
   */
  beforeCommitCreatedObject(interaction) {
    return true;
  }

  /**
   * 固化对象上下文（同步到 node state、标记完成）。
   * 无论后续是否 commit，此步骤始终执行。
   * @param {Object} interaction - 当前交互上下文
   * @protected
   */
  finalizeCreatedObject(interaction) {
    const deviceContext = interaction?.deviceContext ?? {};
    this.syncCreatedObjectContext(deviceContext, this.obj);
    this.isObjectCreationCompleted = true;
  }

  /**
   * 将对象正式提交到静态图。
   * 仅当 {@link beforeCommitCreatedObject} 返回 true 时由
   * {@link completeCreatedObject} 调用。
   * @param {Object} interaction - 当前交互上下文
   * @protected
   */
  commitCreatedObject(interaction) {
    const deviceContext = interaction?.deviceContext ?? {};
    const board = deviceContext.context?.board;
    const completedObject = this.obj;

    if (board?.activeObjectManager?.apply) {
      board.activeObjectManager.apply(new Set([completedObject]));
      this.clearContextObjects(deviceContext);
      return;
    }
    board?.addObject?.(completedObject, completedObject.ownerChunkId);
    this.clearContextObjects(deviceContext);
  }

  /**
   * 对象创建生命周期完成通知。
   * handoff 通过 {@link Tool#on|on('afterCreate', ...)} 订阅。
   * @param {Object} interaction - 当前交互上下文
   * @param {BasicObject} completedObject - 已完成的对象
   * @protected
   */
  afterCompleteCreatedObject(interaction, completedObject) {
    this._emit("afterCreate", interaction, completedObject);
  }

  /**
   * 完成整个对象创建（编排钩子流程）
   * @param {Object} interaction - 当前交互上下文
   */
  completeCreatedObject(interaction) {
    if (!this.obj) return undefined;
    const completedObject = this.obj;

    // ① Finalize：总是执行（同步上下文 + 标记完成）
    this.finalizeCreatedObject(interaction);

    // ② beforeCommit 钩子决定是否进入静态图
    //    handoff 返回 false → 对象留在 AOM 动态图中
    if (this.beforeCommitCreatedObject(interaction) !== false) {
      this.commitCreatedObject(interaction);
    }

    // ③ 通知钩子（无论是否 commit）
    this.afterCompleteCreatedObject(interaction, completedObject);
    return undefined;
  }

  /**
   * 取消整个对象创建
   * @param {Object} interaction - 当前交互上下文
   */
  cancelCreatedObject(interaction) {
    const board = interaction?.deviceContext?.context?.board;
    if (this.obj) {
      if (board?.activeObjectManager?.discard) {
        board.activeObjectManager.discard(new Set([this.obj]));
      } else if (board?.activeObjectManager?.unregisterActiveObject) {
        board.activeObjectManager.unregisterActiveObject(this.obj.id);
      }
    }
    this.clearContextObjects(interaction?.deviceContext ?? {});
    this.reset();
    this.isObjectCreationCompleted = false;
    return undefined;
  }

  /**
   * 工具节点被卸载时撤销未提交对象
   * @param {Object} [deviceContext={}] - 卸载时的设备上下文
   * @returns {void}
   */
  umount(deviceContext = {}) {
    this.discardCreatedObjects(deviceContext);
    this.clearContextObjects(deviceContext);
    this.isCreatingGestureActive = false;
    this.isObjectCreationCompleted = false;
    super.umount(deviceContext);
  }

  /**
   * 创建新的对象实例
   * @param {Vector} position - 新对象的位置
   * @param {number} id - 新对象的 id
   * @param {number} ownerChunkId - 新对象归属区块 id
   * @description 在用户使用该工具创建新对象（而不是编辑正在创建的对象）时调用此方法以生成新的对象实例
   * @abstract
   */
  create(position, id, ownerChunkId) {
    throw new Error("Method not implemented.");
  }
}

/**
 * 单手势对象创建工具
 * @class
 * @abstract
 * @extends ObjectCreatorTool
 * @description
 * 一次对象创建只对应一个手势。手势结束即对象结束，手势取消即对象取消。
 */
class SingleGestureObjectCreatorTool extends ObjectCreatorTool {
  /**
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket);

    const interaction = this.buildInteractionContext(
      normalizedPacket,
      deviceContext,
    );

    if (interaction.isGestureCancelled) {
      this.cancelCreationGesture(interaction);
      this.cancelCreatedObject(interaction);
      this.isCreatingGestureActive = false;
      return;
    }

    if (!interaction.position) {
      if (interaction.isGestureEnded && this.isCreatingGestureActive) {
        this.completeCreationGesture(interaction);
        this.completeCreatedObject(interaction);
        this.isCreatingGestureActive = false;
      }
      return;
    }

    if (!this.ensureObject(interaction)) {
      return;
    }

    if (!this.isCreatingGestureActive) {
      this.beforeGeometryMutation(interaction);
      this.beginCreationGesture(interaction);
      this.afterGeometryMutation(interaction);
      this.isCreatingGestureActive = true;
    } else {
      this.beforeGeometryMutation(interaction);
      this.updateCreationGesture(interaction);
      this.afterGeometryMutation(interaction);
    }

    if (interaction.isGestureEnded) {
      this.beforeGeometryMutation(interaction);
      this.completeCreationGesture(interaction);
      this.afterGeometryMutation(interaction);
      this.completeCreatedObject(interaction);
      this.isCreatingGestureActive = false;
    }
  }
}

/**
 * 多手势对象创建工具
 * @class
 * @abstract
 * @extends ObjectCreatorTool
 * @description
 * 一个对象由多个手势逐步完成。`end/cancel` 仅作用于当前手势，
 * `object-end/object-cancel` 才作用于整个对象。
 */
class MultiGestureObjectCreatorTool extends ObjectCreatorTool {
  /**
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket);

    const interaction = this.buildInteractionContext(
      normalizedPacket,
      deviceContext,
    );

    if (interaction.isObjectCancelled) {
      if (this.isCreatingGestureActive) {
        this.cancelCreationGesture(interaction);
      }
      this.cancelCreatedObject(interaction);
      this.isCreatingGestureActive = false;
      return;
    }

    if (interaction.isGestureCancelled) {
      if (this.isCreatingGestureActive) {
        this.cancelCreationGesture(interaction);
        this.isCreatingGestureActive = false;
      }
      return;
    }

    if (interaction.isObjectEnded) {
      if (this.isCreatingGestureActive) {
        this.beforeGeometryMutation(interaction);
        this.completeCreationGesture(interaction);
        this.afterGeometryMutation(interaction);
        this.isCreatingGestureActive = false;
      }
      this.completeCreatedObject(interaction);
      return;
    }

    if (!interaction.position) {
      if (interaction.isGestureEnded && this.isCreatingGestureActive) {
        this.completeCreationGesture(interaction);
        this.isCreatingGestureActive = false;
      }
      return;
    }

    if (!this.ensureObject(interaction)) {
      return;
    }

    if (!this.isCreatingGestureActive) {
      this.beforeGeometryMutation(interaction);
      this.beginCreationGesture(interaction);
      this.afterGeometryMutation(interaction);
      this.isCreatingGestureActive = true;
    } else {
      this.beforeGeometryMutation(interaction);
      this.updateCreationGesture(interaction);
      this.afterGeometryMutation(interaction);
    }

    if (interaction.isGestureEnded) {
      this.beforeGeometryMutation(interaction);
      this.completeCreationGesture(interaction);
      this.afterGeometryMutation(interaction);
      this.isCreatingGestureActive = false;
    }
  }
}

export {
  ObjectCreatorTool,
  SingleGestureObjectCreatorTool,
  MultiGestureObjectCreatorTool,
  OBJECT_CREATOR_SIGNAL_TYPES,
};
