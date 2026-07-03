/**
 * @file 对象创建工具
 * @description 提供对象创建流程与信号类型定义的工具基类。
 * @module core/tools/creator/object-creator
 * @author Zhou Chenyu
 */

import { Vector } from "../../utils/math.js";
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
    this._local = null;
    this.objectId = null;
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
   * 当前正在创建对象的本地状态
   * @description
   * 纯数据对象 { id, position, property, data }，不再持有 BasicObject 实例。
   * 手势期几何读写均通过此对象完成，Worker 侧同步通过 RPC fire-and-forget 平行维护。
   * @type {{ id: number, position: Vector, property: Record<string,any>, data: Record<string,any> } | null}
   */
  _local;

  /**
   * 当前创建对象的 id
   * @type {number | null}
   */
  objectId;

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
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {Object} 交互上下文
   */
  buildInteractionContext(signalPacket, context = {}) {
    const signals = signalPacket.signals;
    const positionSignal = signals.find(
      (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
    );
    const position =
      context.resolvePosition?.(signalPacket) ??
      Vector.parse(
        positionSignal?.context?.value ?? positionSignal?.context?.position,
      );
    return {
      signalPacket,
      context,
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
      objectId: positionSignal?.context?.objectId ?? context.acc?.objectId,
      injectedProperty: extractInjectedProperty(signals),
    };
  }

  /**
   * 返回当前 Creator 对应的对象类型名
   * @returns {string} 对象类型名；未接入 BoardApi 创建路径时返回 undefined
   * @protected
   */
  getCreatedObjectType() {
    throw new Error("Method not implemented.");
  }

  /**
   * 解析新对象的初始属性
   * @param {Object} interaction - 当前交互上下文
   * @returns {Record<string, any>} 初始属性快照
   * @protected
   */
  resolveCreatedObjectProperty(interaction) {
    const baseProperty =
      this.property &&
      typeof this.property === "object" &&
      !Array.isArray(this.property)
        ? this.property
        : {};

    return {
      ...baseProperty,
      ...(interaction?.injectedProperty ?? {}),
    };
  }

  /**
   * 解析新对象的初始专属数据
   * @param {Object} interaction - 当前交互上下文
   * @returns {Record<string, any>} 初始数据快照
   * @protected
   */
  resolveCreatedObjectData(interaction) {
    return {};
  }

  /**
   * 初始化当前创建对象的本地草稿状态
   * @param {Object} interaction - 当前交互上下文
   * @param {Record<string, any>} property - 初始属性快照
   * @param {Record<string, any>} data - 初始数据快照
   * @returns {Object} 本地草稿对象
   * @protected
   */
  initializeCreatedObjectDraft(interaction, property, data) {
    this.create(interaction.position, interaction.objectId);
    const createdObject = this._local;

    if (!createdObject) {
      throw new Error(
        `Failed to create local draft object: ${interaction.objectId}`,
      );
    }

    if (property) {
      Object.assign(createdObject.property, property);
    }
    if (data) {
      Object.assign(createdObject.data, data);
    }

    return createdObject;
  }

  /**
   * 通过 BoardApi 创建对象并初始化本地草稿
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean} 是否成功走 BoardApi 创建路径
   * @protected
   */
  createObjectThroughBoardApi(interaction) {
    const boardApi = interaction?.context?.acc?.boardApi;
    const objectType = this.getCreatedObjectType();

    if (
      !boardApi ||
      typeof objectType !== "string" ||
      interaction?.objectId == null ||
      !interaction?.position
    ) {
      return false;
    }

    const property = this.resolveCreatedObjectProperty(interaction);
    const data = this.resolveCreatedObjectData(interaction);
    const createdObject = this.initializeCreatedObjectDraft(
      interaction,
      property,
      data,
    );

    boardApi.createObject(objectType, {
      id: interaction.objectId,
      position: interaction.position,
      property,
      data,
    });

    this.objectId = interaction.objectId;
    this._local = createdObject;
    return true;
  }

  /**
   * 确保当前交互已拥有对象实例
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean} 是否已拥有对象实例
   */
  ensureObject(interaction) {
    if (!this._local || this.isObjectCreationCompleted) {
      this._pendingProperty = interaction?.injectedProperty ?? null;

      // 惰性分配 objectId：仅当需要创建新对象时才调用 allocateObjectId
      if (interaction.objectId == null) {
        const allocatedId =
          interaction?.context?.acc?.allocateObjectId?.() ??
          interaction?.context?.acc?.board?.allocateObjectId?.();
        if (allocatedId != null) {
          interaction.objectId = allocatedId;
        }
      }

      if (interaction.objectId == null) {
        return false;
      }

      this.objectId = interaction.objectId;

      if (!this.createObjectThroughBoardApi(interaction)) {
        this._pendingProperty = null;
        return false;
      }

      this._pendingProperty = null;
      this.isObjectCreationCompleted = false;
      this.syncCreatedObjectContext(interaction?.context);
    }

    return true;
  }

  /**
   * 将当前创建对象写回上下文
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {BasicObject} [objectEntry=this.obj] - 当前对象
   * @returns {Array<BasicObject>}
   */
  syncCreatedObjectContext(context = {}, localState = this._local) {
    return this.setContextObjects(context, localState ? [localState] : []);
  }

  /**
   * 卸载或结束 workflow 时撤销未提交对象
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  discardCreatedObjects(context = {}) {
    const boardApi = context?.acc?.boardApi;
    if (boardApi && this.objectId != null) {
      boardApi.discardActiveObjects([this.objectId]);
    }
  }

  /**
   * 处理一个完整信号包
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   * @abstract
   */
  process(signalPacket, context = {}) {
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
   * 在对象几何变更前执行钩子
   * @description Creator 的几何脏区与快照由 Core 侧自动处理，此处保留为空钩子。
   * @param {Object} interaction - 当前交互上下文
   */
  beforeGeometryMutation(interaction) {
    return undefined;
  }

  /**
   * 在对象几何变更后请求活动层刷新
   * @description Creator 的渲染脏区由 Core 自动处理，这里仅触发 UI overlay 刷新。
   * @param {Object} interaction - 当前交互上下文
   */
  afterGeometryMutation(interaction) {
    if (!this._local) return;
    this.requestUiOverlayRefresh(interaction?.context ?? {});
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
   * 决定 finalize 之后是否将对象提交到静态图
   * @description
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
   * 固化对象上下文（同步到 node state、标记完成）
   * @description
   * 无论后续是否 commit，此步骤始终执行。
   * @param {Object} interaction - 当前交互上下文
   * @protected
   */
  finalizeCreatedObject(interaction) {
    const context = interaction?.context ?? {};
    this.syncCreatedObjectContext(context, this._local);
    this.isObjectCreationCompleted = true;
  }

  /**
   * 将对象正式提交到静态图
   * @description
   * 仅当 {@link beforeCommitCreatedObject} 返回 true 时由
   * {@link completeCreatedObject} 调用。
   * @param {Object} interaction - 当前交互上下文
   * @protected
   */
  commitCreatedObject(interaction) {
    const context = interaction?.context ?? {};
    const boardApi = context.acc?.boardApi;

    if (boardApi && this.objectId != null) {
      boardApi.commitObjects([this.objectId]);
    }

    this.clearContextObjects(context);
  }

  /**
   * 对象创建生命周期完成通知。
   * handoff 通过 {@link Tool#on|on('afterCreate', ...)} 订阅。
   * @param {Object} interaction - 当前交互上下文
   * @param {{ id: number, position: Vector, property: Record<string,any>, data: Record<string,any> }} completedObject - 已完成的对象
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
    if (!this._local) return undefined;
    const completedObject = this._local;

    // 1. Finalize：总是执行（同步上下文 + 标记完成）
    this.finalizeCreatedObject(interaction);

    // 2. beforeCommit 钩子决定是否进入静态图
    //    handoff 返回 false → 对象留在 AOM 动态图中
    if (this.beforeCommitCreatedObject(interaction) !== false) {
      this.commitCreatedObject(interaction);
    }

    // 3. afterComplete 钩子通知（无论是否 commit）
    this.afterCompleteCreatedObject(interaction, completedObject);
    return undefined;
  }

  /**
   * 取消整个对象创建
   * @param {Object} interaction - 当前交互上下文
   */
  cancelCreatedObject(interaction) {
    const boardApi = interaction?.context?.acc?.boardApi;
    if (this._local && boardApi && this.objectId != null) {
      boardApi.discardActiveObjects([this.objectId]);
    }
    this.clearContextObjects(interaction?.context ?? {});
    this.reset();
    this.objectId = null;
    this.isObjectCreationCompleted = false;
    return undefined;
  }

  /**
   * 工具节点被卸载时撤销未提交对象
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
    this.discardCreatedObjects(context);
    this.clearContextObjects(context);
    this.objectId = null;
    this.isCreatingGestureActive = false;
    this.isObjectCreationCompleted = false;
    super.umount(context);
  }

  /**
   * 创建当前手势使用的本地状态对象
   * @param {Vector} position - 新对象的位置
   * @param {number} id - 新对象的 id
   * @description
   * 子类应初始化 this._local 为纯数据对象 { id, position, property, data }。
   * 不再创建 BasicObject 子类实例——手势期几何读写仅需纯数据。
   * Worker 侧真实对象通过 RPC fire-and-forget 平行维护。
   * @abstract
   */
  create(position, id) {
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
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, context = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket);

    const interaction = this.buildInteractionContext(normalizedPacket, context);

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
      this.updateCreationGesture(interaction);
      this.afterGeometryMutation(interaction);
    }

    if (interaction.isGestureEnded) {
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
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, context = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket);

    const interaction = this.buildInteractionContext(normalizedPacket, context);

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
      this.updateCreationGesture(interaction);
      this.afterGeometryMutation(interaction);
    }

    if (interaction.isGestureEnded) {
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
