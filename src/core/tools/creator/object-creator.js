/**
 * @file 对象创建工具
 * @description 提供对象创建流程与信号类型定义的工具基类。
 * @module core/tools/creator/object-creator
 * @author Zhou Chenyu
 */

import { Vector } from "../../utils/math.js";
import { SignalPacket } from "../../devices-dag/signal.js";
import { GestureTool } from "../gesture-tool.js";

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
 * @param {Array<Object>} signals - 输入信号列表
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
 * @extends GestureTool
 * @description
 * 对象创建工具负责在白板上创建新对象。
 * 该基类复用 GestureTool 的手势路由骨架，但保留 Creator 自身的提交语义：
 * finalize 总是执行，beforeCommit 仅决定是否进入静态图，不影响 `action:complete` 通知。
 * @author Zhou Chenyu
 */
class ObjectCreatorTool extends GestureTool {
  /**
   * 当前正在创建对象的本地状态
   * @description
   * 纯数据对象，遵循 LightweightObjectEntry 协议，不再持有 BasicObject 实例。
   * 手势期几何读写均通过此对象完成，Worker 侧同步通过 RPC fire-and-forget 平行维护。
   * 子类的 `create()` 实现应设置 `type` 字段与其 `getCreatedObjectType()` 返回值一致。
   * @type {import("../../shared/types.js").LightweightObjectEntry | null}
   */
  _entry;

  /**
   * 当前创建对象的 id
   * @type {number | null}
   */
  objectId;

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
   * 最近一次动作提交时持有的交互上下文
   * @type {Object|null}
   * @protected
   */
  _pendingActionInteraction;

  /**
   * @constructor
   */
  constructor() {
    super();
    this.autoActionOnGestureEnd = true;
    this._entry = null;
    this.objectId = null;
    this.isObjectCreationCompleted = false;
    this._pendingProperty = null;
    this._pendingActionInteraction = null;
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
   * @return {Object} 序列化后的工具数据
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 构建 Creator 交互上下文
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {Object} 交互上下文
   */
  buildInteractionContext(signalPacket, context = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket);
    const baseInteraction = super.buildInteraction(normalizedPacket, context);
    const signals = normalizedPacket.signals;
    const positionSignal = signals.find(
      (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
    );

    return {
      ...baseInteraction,
      signalPacket: normalizedPacket,
      isGestureEnded: baseInteraction.hasEnd,
      isGestureCancelled: baseInteraction.hasCancel,
      isObjectEnded: baseInteraction.hasObjectEnd,
      isObjectCancelled: baseInteraction.hasObjectCancel,
      objectId: positionSignal?.context?.objectId ?? context.acc?.objectId,
      injectedProperty: extractInjectedProperty(signals),
    };
  }

  /**
   * 兼容 GestureTool 的交互构建入口
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {Object} 交互上下文
   */
  buildInteraction(signalPacket, context = {}) {
    return this.buildInteractionContext(signalPacket, context);
  }

  /**
   * 返回当前 Creator 对应的对象类型名
   * @returns {string} 对象类型名；未接入创建路径时返回 undefined
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
    const createdObject = this._entry;

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
   * 通过 RPC 创建对象并初始化本地草稿
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean} 是否成功通过 RPC 创建对象
   * @protected
   */
  createObjectViaRpc(interaction) {
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

    Promise.resolve(
      boardApi.createObject(objectType, {
        id: interaction.objectId,
        position: interaction.position,
        property,
        data,
      }),
    ).catch((error) => {
      console.error(
        `[Creator] Failed to create object ${interaction.objectId} via RPC:`,
        error,
      );
    });

    this.objectId = interaction.objectId;
    this._entry = createdObject;
    return true;
  }

  /**
   * 确保当前交互已拥有对象实例
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean} 是否已拥有对象实例
   */
  ensureObject(interaction) {
    if (!this._entry || this.isObjectCreationCompleted) {
      this._pendingProperty = interaction?.injectedProperty ?? null;

      if (interaction.objectId == null) {
        const allocatedId =
          interaction?.context?.acc?.board?.allocateObjectId?.();
        if (allocatedId != null) {
          interaction.objectId = allocatedId;
        }
      }

      if (interaction.objectId == null) {
        return false;
      }
      this.objectId = interaction.objectId;

      if (!this.createObjectViaRpc(interaction)) {
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
   * GestureTool 生命周期适配：确保草稿对象存在
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean}
   * @protected
   */
  _ensureObject(interaction) {
    return this.ensureObject(interaction);
  }

  /**
   * 将当前创建对象写回上下文
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {BasicObject} [objectEntry=this.obj] - 当前对象
   * @returns {Array<BasicObject>}
   */
  syncCreatedObjectContext(context = {}, localState = this._entry) {
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
   * 在 position 信号到达时处理 Creator 的空间更新
   * @description
   * Creator 与通用 GestureTool 的区别在于：首个 position 仅执行 begin，不在同一帧执行 update，
   * 以保持 Stroke/Circle/Polygon 现有的计数与几何语义不变。
   * @param {Object} interaction - 当前交互上下文
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
      return;
    }

    this.updateGesture(interaction);
    this._emit("gesture:update", interaction);
  }

  /**
   * 开始一次创建手势
   * @param {Object} interaction - 当前交互上下文
   */
  beginGesture(interaction) {
    this.beforeGeometryMutation(interaction);
    this.afterGeometryMutation(interaction);
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
   * @description
   * boardApi 存在时 Creator 通过 RPC 修改对象，Core 侧 RPC handler 已自动
   * 触发 liveRenderer 重绘。此处仅刷新 UI overlay。
   * @param {Object} interaction - 当前交互上下文
   */
  afterGeometryMutation(interaction) {
    if (!this._entry) return;
    this.requestUiOverlayRefresh(interaction?.context ?? {});
  }

  /**
   * 更新一次创建手势
   * @param {Object} interaction - 当前交互上下文
   */
  updateGesture(interaction) {
    this.afterGeometryMutation(interaction);
  }

  /**
   * 完成一次创建手势
   * @param {Object} interaction - 当前交互上下文
   */
  completeGesture(interaction) {
    this.afterGeometryMutation(interaction);
    return undefined;
  }

  /**
   * 取消当前创建手势
   * @param {Object} interaction - 当前交互上下文
   */
  cancelGesture(interaction) {
    return undefined;
  }

  /**
   * 解析已完成对象的局部外接矩形
   * @description
   * 子类覆写此方法，在 `finalizeCreatedObject` 中被调用，
   * 将计算结果回填到 `this._entry.boundingBox`，使创建态条目
   * 可以被 modifier 直接消费（准入检测、overlay 渲染）。
   * @param {Object} interaction - 当前交互上下文
   * @returns {{ left: number, top: number, width: number, height: number }|undefined} 局部外接矩形
   * @protected
   */
  resolveCreatedObjectBoundingBox(interaction) {
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
   * 同时回填 `boundingBox`，确保条目在后续 handoff 桥接时
   * 携带完整的几何边界信息。
   * @param {Object} interaction - 当前交互上下文
   * @protected
   */
  finalizeCreatedObject(interaction) {
    const context = interaction?.context ?? {};
    const boundingBox = this.resolveCreatedObjectBoundingBox(interaction);
    if (boundingBox && this._entry) {
      this._entry.boundingBox = boundingBox;
    }

    this.syncCreatedObjectContext(context, this._entry);
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
   * 对象创建完成后的扩展钩子
   * @param {Object} interaction - 当前交互上下文
   * @param {{ id: number, position: Vector, property: Record<string,any>, data: Record<string,any> }} completedObject - 已完成的对象
   * @returns {void}
   * @protected
   */
  afterCompleteCreatedObject(interaction, completedObject) {}

  /**
   * 完成整个对象创建（编排钩子流程）
   * @description completeCreatedObject 是旧版入口，保持对外兼容。
   * 它将 interaction 桥接到 completeAction 后由 GestureTool 统一编排。
   * @param {Object} interaction - 当前交互上下文
   * @returns {undefined}
   */
  completeCreatedObject(interaction) {
    this._pendingActionInteraction = interaction;
    try {
      return this.completeAction(interaction?.context);
    } finally {
      this._pendingActionInteraction = null;
    }
  }

  /**
   * GestureTool 生命周期适配：完成 Creator 动作
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {undefined}
   */
  completeAction(context) {
    if (!this._entry) {
      return undefined;
    }

    const interaction = this._pendingActionInteraction ?? {
      context,
      signalPacket: SignalPacket.from({ signals: [] }),
      signals: [],
      position: null,
    };

    // finalize 总是执行，beforeCommit 决定是否 commit
    this.finalizeCreatedObject(interaction);

    if (this.beforeCommitCreatedObject(interaction) !== false) {
      this.commitCreatedObject(interaction);
    }

    this.afterCompleteCreatedObject(interaction, this._entry);
    super.afterAction(context, this._entry);
    return undefined;
  }

  /**
   * 取消整个对象创建
   * @param {Object} interaction - 当前交互上下文
   * @returns {void}
   */
  cancelCreatedObject(interaction) {
    this.discardAction(interaction?.context ?? {});
    return undefined;
  }

  /**
   * GestureTool 生命周期适配：丢弃当前创建对象
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   * @protected
   */
  discardAction(context) {
    this.discardCreatedObjects(context);
    this.clearContextObjects(context);
    this.reset();
    this.objectId = null;
    this.isObjectCreationCompleted = false;
    this._pendingActionInteraction = null;
  }

  /**
   * GestureTool 生命周期适配：处理单手势 end
   * @param {Object} interaction - 当前交互上下文
   * @returns {undefined}
   * @protected
   */
  _onEnd(interaction) {
    if (this.isGestureActive) {
      this.completeGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:end", interaction);
    }

    if (!this.autoActionOnGestureEnd) {
      return undefined;
    }

    this._pendingActionInteraction = interaction;
    try {
      return this.completeCreatedObject(interaction);
    } finally {
      this._pendingActionInteraction = null;
    }
  }

  /**
   * 创建当前手势使用的本地状态对象
   * @param {Vector} position - 新对象的位置
   * @param {number} id - 新对象的 id
   * @description
   * 子类应初始化 this._entry 为纯数据对象，遵循 LightweightObjectEntry 协议。
   * 其中 `type` 字段应与 {@link getCreatedObjectType} 的返回值一致。
   * 不再创建 BasicObject 子类实例——手势期几何读写仅需纯数据。
   * Worker 侧真实对象通过 RPC fire-and-forget 平行维护。
   * @abstract
   */
  create(position, id) {
    throw new Error("Method not implemented.");
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
    this.isGestureActive = false;
    this.isObjectCreationCompleted = false;
    this._pendingActionInteraction = null;
    super.umount(context);
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
class SingleGestureObjectCreatorTool extends ObjectCreatorTool {}

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
   * 处理多手势中的 end 信号
   * @param {Object} interaction - 当前交互上下文
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
   * 处理多手势中的 cancel 信号
   * @param {Object} interaction - 当前交互上下文
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
   * 处理多手势中的 object-end 信号
   * @param {Object} interaction - 当前交互上下文
   * @returns {undefined}
   * @protected
   */
  _onObjectEnd(interaction) {
    if (this.isGestureActive) {
      this.completeGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:end", interaction);
    }

    this._pendingActionInteraction = interaction;
    try {
      return this.completeCreatedObject(interaction);
    } finally {
      this._pendingActionInteraction = null;
    }
  }

  /**
   * 处理多手势中的 object-cancel 信号
   * @param {Object} interaction - 当前交互上下文
   * @returns {void}
   * @protected
   */
  _onObjectCancel(interaction) {
    if (this.isGestureActive) {
      this.cancelGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:cancel", interaction);
    }

    this.cancelCreatedObject(interaction);
  }
}

export {
  ObjectCreatorTool,
  SingleGestureObjectCreatorTool,
  MultiGestureObjectCreatorTool,
  OBJECT_CREATOR_SIGNAL_TYPES,
};
