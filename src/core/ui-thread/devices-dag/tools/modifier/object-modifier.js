/**
 * @file 对象修改工具
 * @description 提供对象几何和属性修改的基础工具实现。
 * @module core/ui-thread/devices-dag/tools/modifier/object-modifier
 * @author Zhou Chenyu
 */

import { GestureTool } from "../gesture-tool.js";
import { SignalPacket } from "../../signal.js";
import { BasicObject } from "../../../../engine/objects/basic-obj.js";
import { RectangleRange } from "../../../../engine/range/index.js";
import { Vector } from "../../../../engine/utils/math.js";
import { createCompatSelectionEntriesForSummaries } from "../../../components/renderer/ui-overlay-factory.js";

/**
 * 对象修改工具相关信号类型常量
 * @readonly
 * @enum {string}
 */
const OBJECT_MODIFIER_SIGNAL_TYPES = Object.freeze({
  /** 世界坐标位置更新 */
  POSITION: "position",
  /** 相对位移（增量） */
  DISPLACEMENT: "displacement",
  /** 手势结束（对象留在动态图） */
  GESTURE_END: "end",
  /** 手势取消 */
  GESTURE_CANCEL: "cancel",
  /** 将修改提交到静态图 */
  SUCCESS: "success",
});

/**
 * 修改手势交互上下文
 * @typedef {Object} ModifyGestureInteraction
 * @property {SignalPacket} signalPacket - 输入信号包
 * @property {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
 * @property {Array<{type: string, context?: *}>} signals - 信号列表
 * @property {Vector|null} position - 世界坐标位置
 * @property {Vector|null} displacement - 相对位移
 * @property {import("../../shared/types.js").LightweightObjectEntry[]} objects - 当前活动的修改对象
 * @property {boolean} hasEndSignal - 是否包含结束信号
 * @property {boolean} hasCancelSignal - 是否包含取消信号
 * @property {boolean} hasSuccessSignal - 是否包含提交信号
 */

/**
 * 对象修改工具基类
 * @class
 * @abstract
 * @extends GestureTool
 * @description
 * 对象修改工具负责改变已有对象的几何形态、样式或其它可编辑属性。
 */
class ObjectModifierTool extends GestureTool {
  /**
   * overlay 渲染用——当前编辑中的对象集合
   * @type {import("../../shared/types.js").LightweightObjectEntry[]}
   * @protected
   */
  _overlayModifiedObjects = [];

  /**
   * 当前待提交的对象集合缓存
   * @type {Array<BasicObject>|null}
   * @protected
   */
  _pendingActionObjects = null;

  /**
   * 当前待提交的对象 id 集合缓存
   * @type {number[]|null}
   * @protected
   */
  _pendingActionObjectIds = null;

  /**
   * 收集 modifier 当前声明的兼容 ui overlay
   * @param {{
   *   viewport?: import("../../components/orchestration/viewport.js").Viewport,
   *   renderer?: import("../../components/renderer/ui-renderer.js").UiRenderer,
   * }} [overlayContext={}] - overlay 上下文
   * @returns {import("../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    const { viewport, renderer } = overlayContext;
    const objects = this._overlayModifiedObjects;

    if (objects.length === 0 || !renderer) {
      return [];
    }

    return createCompatSelectionEntriesForSummaries(
      objects,
      "modifier",
      viewport,
    );
  }

  /**
   * 规整本次修改涉及的对象集合
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   * @returns {Array<BasicObject>}
   */
  resolveModifiedObjects(context, objects) {
    if (objects == null) {
      return this.resolveContextObjects(context);
    }

    return this.normalizeObjectCollection(objects);
  }

  /**
   * 解析对象条目的当前位置
   * @param {import("../../shared/types.js").LightweightObjectEntry} objectEntry - 对象实例或兼容条目
   * @returns {Vector|null} 当前位置
   * @protected
   */
  resolveModifiedObjectPosition(objectEntry) {
    return Vector.parse(objectEntry?.position);
  }

  /**
   * 解析对象条目的局部判定范围
   * @param {import("../../shared/types.js").LightweightObjectEntry} objectEntry - 对象实例或兼容条目
   * @returns {import("../../range/range.js").Range|null} 局部 range
   * @protected
   */
  resolveModifiedObjectRange(objectEntry) {
    if (objectEntry?.range) {
      return objectEntry.range;
    }
    if (typeof objectEntry?.getRange === "function") {
      return objectEntry.getRange();
    }
    return null;
  }

  /**
   * 解析对象条目的世界矩形
   * @param {import("../../shared/types.js").LightweightObjectEntry} objectEntry - 对象实例或兼容条目
   * @returns {RectangleRange|null} 世界矩形
   * @protected
   */
  resolveModifiedObjectWorldRect(objectEntry) {
    const position = this.resolveModifiedObjectPosition(objectEntry);
    const localRange = this.resolveModifiedObjectRange(objectEntry);
    if (
      position &&
      localRange &&
      typeof localRange.withPosition === "function"
    ) {
      return RectangleRange.from(localRange.withPosition(position));
    }

    const localBoundingBoxSource =
      objectEntry?.boundingBox ?? objectEntry?.rich?.boundingBox;
    const localBoundingBox = localBoundingBoxSource
      ? RectangleRange.fromRectLike(localBoundingBoxSource)
      : null;
    if (
      position &&
      localBoundingBox &&
      typeof localBoundingBox.withPosition === "function"
    ) {
      return RectangleRange.from(localBoundingBox.withPosition(position));
    }

    return null;
  }

  /**
   * 通过 RPC 写入对象绝对位置
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {import("../../shared/types.js").LightweightObjectEntry} objectEntry - 当前对象条目
   * @param {{ x: number, y: number }} position - 新位置
   * @returns {void}
   * @protected
   */
  setModifiedObjectPosition(context, objectEntry, position) {
    const normalizedPosition = Vector.parse(position);
    if (!normalizedPosition || !objectEntry) return;

    const nextPosition = new Vector(normalizedPosition.x, normalizedPosition.y);
    const objectId = this.resolveObjectId(objectEntry);
    const boardApi = context?.services?.boardApi;
    if (boardApi && objectId != null) {
      boardApi.modifyObject(objectId, {
        position: {
          x: normalizedPosition.x,
          y: normalizedPosition.y,
        },
      });
    }

    objectEntry.position = nextPosition;
  }

  /**
   * 接收 handoff 传递的活跃修改对象
   * @description
   * 当 handoff 从第一阶段（chooser/creator）切换到第二阶段（modifier）时立即调用。
   * 工具将对象存入私有字段 _overlayModifiedObjects，作为唯一权威数据来源。
   * 不写 node state——process() 执行时会通过 setContextObjects 写入正确的路径。
   * 存完后触发 UI overlay 刷新，使 overlay 系统立即收集工具的条目。
   * 已被同步的情况下重复调用不会重复写入。
   * @param {Array<Object>} objects - handoff 桥接的对象摘要
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文（用于触发 overlay 刷新）
   * @returns {void}
   */
  receiveHandoffObjects(objects, context = {}) {
    if (this._overlayModifiedObjects.length > 0) return;
    this._overlayModifiedObjects = this.normalizeObjectCollection(objects);

    // 确保 overlay provider 已在 viewport 注册。
    // createUiOverlayBinding 内建缓存，后续 processor 的 sync 不会重复注册。
    this.syncUiOverlay(context);

    this.requestUiOverlayRefresh(context);
  }

  /**
   * 解析当前仍处于 AOM 动态图中的对象集合
   * @description
   * 优先从私有字段 _overlayModifiedObjects 读取（handoff 桥接或自身 process 写入）。
   * 私有字段为空时回退到 resolveModifiedObjects（原生非 handoff 场景兼容）。
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   * @returns {Array<BasicObject>}
   */
  resolveActiveModifiedObjects(context, objects) {
    if (this._overlayModifiedObjects.length > 0) {
      return this._overlayModifiedObjects;
    }
    return this.resolveModifiedObjects(context, objects);
  }

  /**
   * 在对象几何修改前记录旧快照
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   */
  beforeGeometryMutation(context, objects) {
    const normalizedObjects = this.resolveModifiedObjects(context, objects);

    if (normalizedObjects.length === 0) return;
    if (context?.services?.boardApi) return;

    context?.services?.viewport?.renderer?.captureObjectSnapshot?.(
      normalizedObjects,
    );
  }

  /**
   * 在对象几何修改后请求活动层刷新
   * @description
   * boardApi 存在时 Core 侧 RPC handler 已自动触发 ViewportRenderer 输出刷新，
   * 此处仅刷新 UI overlay。非 boardApi 路径自行失效 live 脏区。
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   */
  afterGeometryMutation(context, objects) {
    const normalizedObjects = this.resolveModifiedObjects(context, objects);

    if (normalizedObjects.length === 0) return;

    if (context?.services?.boardApi) {
      this.requestUiOverlayRefresh(context);
      return;
    }

    context?.services?.viewport?.renderer?.invalidateActiveObjects?.(
      normalizedObjects,
    );
    context?.services?.viewport?.requestViewportUiRender?.();
  }

  /**
   * 以统一的快照协议包装一次几何修改
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Function} mutate - 实际执行修改的回调
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   * @param {{ captureSnapshot?: boolean }} [options={}] - 选项对象
   * @returns {*}
   */
  withGeometryMutation(context, mutate, objects, options = {}) {
    const { captureSnapshot = true } = options;
    const normalizedObjects = this.resolveModifiedObjects(context, objects);

    if (captureSnapshot) {
      this.beforeGeometryMutation(context, normalizedObjects);
    }
    try {
      return mutate?.();
    } finally {
      this.afterGeometryMutation(context, normalizedObjects);
    }
  }

  /**
   * 解析当前动作应提交的对象集合
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   * @returns {Array<BasicObject>}
   * @protected
   */
  resolveActionObjects(context, objects) {
    if (objects != null) {
      return this.resolveActiveModifiedObjects(context, objects);
    }

    if (Array.isArray(this._pendingActionObjects)) {
      return this._pendingActionObjects;
    }

    return this.resolveActiveModifiedObjects(context);
  }

  /**
   * 决定是否执行 apply
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Array<BasicObject>} objects - 已解析的活动对象
   * @returns {boolean}
   * @protected
   */
  beforeApplyModifiedObjects(context, objects) {
    return true;
  }

  /**
   * GestureTool 生命周期适配：动作执行前校验
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {boolean}
   * @protected
   */
  beforeAction(context) {
    const normalizedObjects = this.resolveActionObjects(context);

    if (normalizedObjects.length === 0) {
      this.clearContextObjects(context);
      return false;
    }

    if (this.beforeApplyModifiedObjects(context, normalizedObjects) === false) {
      return false;
    }

    const boardApi = context?.services?.boardApi;
    const objectIds = this.resolveObjectIds(context, normalizedObjects);
    if (!boardApi || objectIds.length === 0) {
      this.clearContextObjects(context);
      return false;
    }

    this._pendingActionObjects = normalizedObjects;
    this._pendingActionObjectIds = objectIds;
    return true;
  }

  /**
   * GestureTool 生命周期适配：执行对象提交流程
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {boolean}
   * @protected
   */
  performAction(context) {
    const normalizedObjects = this.resolveActionObjects(context);
    const objectIds =
      this._pendingActionObjectIds ??
      this.resolveObjectIds(context, normalizedObjects);
    const boardApi = context?.services?.boardApi;

    if (!boardApi || objectIds.length === 0) {
      this.clearContextObjects(context);
      return false;
    }

    boardApi.commitObjects(objectIds);
    this.clearContextObjects(context);

    const autoUmount = context.acc?.autoUmountOnApply !== false;
    if (
      autoUmount &&
      typeof context.dag?.unmount === "function" &&
      typeof context.path === "string"
    ) {
      context.dag.unmount(context.path);
    }

    return true;
  }

  /**
   * 提交成功后的扩展钩子
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Array<BasicObject>} objects - 已提交的对象
   * @param {boolean} result - 提交结果
   * @returns {void}
   * @protected
   */
  afterApplyModifiedObjects(context, objects, result) {}

  /**
   * GestureTool 生命周期适配：动作完成后的通知
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {boolean} result - 动作结果
   * @returns {void}
   * @protected
   */
  afterAction(context, result) {
    const normalizedObjects = this.resolveActionObjects(context);
    super.afterAction(context, result);
    this.afterApplyModifiedObjects(context, normalizedObjects, result);
    this._pendingActionObjects = null;
    this._pendingActionObjectIds = null;
  }

  /**
   * GestureTool 生命周期适配：丢弃当前动作持有对象
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   * @protected
   */
  discardAction(context) {
    const normalizedObjects = this.resolveActionObjects(context);
    const boardApi = context?.services?.boardApi;
    const objectIds = this.resolveObjectIds(context, normalizedObjects);

    if (boardApi && objectIds.length > 0) {
      boardApi.discardActiveObjects(objectIds);
    }

    this.clearContextObjects(context);
    this._pendingActionObjects = null;
    this._pendingActionObjectIds = null;
  }

  /**
   * 清理 modifier 的 overlay 临时状态
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   * @protected
   */
  clearOverlayState(context = {}) {
    this._overlayModifiedObjects = [];
    this.requestUiOverlayRefresh(context);
  }

  /**
   * 将当前修改对象提交回静态图
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Iterable<BasicObject>|BasicObject} [objects] - 显式传入的对象或对象集合
   * @returns {boolean}
   */
  applyModifiedObjects(context, objects) {
    this._pendingActionObjects = this.resolveActionObjects(context, objects);
    this._pendingActionObjectIds = null;

    try {
      return this.completeAction(context) === true;
    } finally {
      this._pendingActionObjects = null;
      this._pendingActionObjectIds = null;
    }
  }

  /**
   * 在修改工具被卸载时撤销未提交的活动对象引用
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
    this.isActionActive = false;
    const normalizedObjects = this.resolveActiveModifiedObjects(context);
    const boardApi = context?.services?.boardApi;
    const objectIds = this.resolveObjectIds(context, normalizedObjects);

    if (boardApi && objectIds.length > 0) {
      boardApi.discardActiveObjects(objectIds);
    }

    this.clearContextObjects(context);
    this._pendingActionObjects = null;
    this._pendingActionObjectIds = null;
    super.umount(context);
  }
}

/**
 * 手势驱动对象修改工具
 * @class
 * @abstract
 * @extends ObjectModifierTool
 * @description
 * 内置手势生命周期的对象修改工具，支持 position 与 displacement 双通道信号。
 * 子类只需覆写手势 hook 即可实现具体修改逻辑，无需关心 process() 调度细节。
 *
 * 手势模型：
 * 1. position 信号到达 → 手势开始（beginGesture）或持续更新（updateGesture）
 * 2. displacement 信号到达 → 无状态增量，直接累加到对象位置（无需手势状态机）
 *    基准位置跟随位移同步，锚点不动，保持光标-对象偏移不变
 * 3. end 信号 → 手势结束（completeGesture），对象保留在 AOM 动态图中
 * 4. success 信号 → 提交到静态图（applyModifiedObjects）
 * 5. cancel 信号 → 取消当前手势（cancelGesture），将对象回滚到手势开始时的初始位置
 *
 * 该工具同时接受 world 坐标 position 和相对位移 displacement 驱动。
 * 子类可在 hook 内自行计算增量并更新对象几何。
 *
 * @author Zhou Chenyu
 */
class GestureBasedObjectModifierTool extends ObjectModifierTool {
  /**
   * 当前修改手势是否激活
   * @type {boolean}
   */
  constructor() {
    super();
    this.autoActionOnGestureEnd = false;
  }

  /**
   * 从信号包中提取世界坐标位置
   * @description
   * 优先通过 context.resolvePosition 解析，否则从 position 信号中读取。
   * 所有路径的结果都会经过 Vector.parse 归一化为 Vector。
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {Vector|null}
   * @protected
   */
  _extractPosition(signalPacket, context) {
    if (typeof context.resolvePosition === "function") {
      const resolved = context.resolvePosition(signalPacket);
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
   * 从信号包中提取相对位移
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {Vector|null}
   * @protected
   */
  _extractDisplacement(signalPacket, context) {
    const displacementSignal = signalPacket.signals.find(
      (s) => s.type === OBJECT_MODIFIER_SIGNAL_TYPES.DISPLACEMENT,
    );
    if (!displacementSignal) return null;
    const raw = displacementSignal?.context?.value;
    return Vector.parse(raw);
  }

  /**
   * 从信号包中提取修改交互上下文
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {import("../../shared/types.js").LightweightObjectEntry[]} objects - 当前活动的修改对象
   * @returns {ModifyGestureInteraction} 交互上下文
   * @protected
   */
  buildModifyInteractionContext(signalPacket, context = {}, objects = []) {
    const baseInteraction = super.buildInteraction(signalPacket, context);
    return {
      ...baseInteraction,
      displacement: this._extractDisplacement(signalPacket, context),
      objects,
      hasEndSignal: baseInteraction.hasEnd,
      hasCancelSignal: baseInteraction.hasCancel,
      hasSuccessSignal: baseInteraction.hasSuccess,
    };
  }

  /**
   * 处理信号包（手势驱动）
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, context = {}) {
    const packet = SignalPacket.from(signalPacket);

    const objects = this.resolveActiveModifiedObjects(context);
    if (objects.length === 0) {
      this._overlayModifiedObjects = [];
      return;
    }

    this.setContextObjects(context, objects);
    this._overlayModifiedObjects = objects;
    const interaction = this.buildModifyInteractionContext(
      packet,
      context,
      objects,
    );

    if (interaction.hasCancelSignal) {
      this._handleCancel(interaction, context, objects);
      return;
    }

    if (interaction.hasSuccessSignal) {
      this._handleSuccess(interaction, context, objects);
      return;
    }

    if (!interaction.position && !interaction.displacement) {
      this._handleOrphanEnd(interaction);
      return;
    }

    this._handleSpatialUpdate(interaction, context, objects);
  }

  /**
   * 处理 cancel 信号：取消当前手势
   * @description
   * 无论手势是否激活，都尝试回退对象位置。
   * 手势结束后（end 信号后）cancel 应仍然能回退到手势初始位置，
   * 前提是子类的 completeGesture 保留了 _initialPositions。
   * @param {ModifyGestureInteraction} interaction - 当前交互上下文
   * @private
   */
  _handleCancel(interaction, context, objects) {
    this.withGeometryMutation(
      context,
      () => this.cancelGesture(interaction),
      objects,
      { captureSnapshot: false },
    );
    this.isGestureActive = false;
    this._overlayModifiedObjects = [];
  }

  /**
   * 处理 success 信号：结束手势并提交修改到静态图
   * @param {ModifyGestureInteraction} interaction - 当前交互上下文
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {import("../../shared/types.js").LightweightObjectEntry[]} objects - 活动对象
   * @private
   */
  _handleSuccess(interaction, context, objects) {
    if (this.isGestureActive) {
      this.completeGesture(interaction);
      this.isGestureActive = false;
    }
    this.applyModifiedObjects(context, objects);
    this._overlayModifiedObjects = [];
  }

  /**
   * 处理无位置信号时孤立的 end 信号
   * @param {ModifyGestureInteraction} interaction - 当前交互上下文
   * @private
   */
  _handleOrphanEnd(interaction) {
    if (interaction.hasEndSignal && this.isGestureActive) {
      this.completeGesture(interaction);
      this.isGestureActive = false;
    }
  }

  /**
   * 处理空间更新：position / displacement 双通道
   * @description
   * 1. position 驱动手势状态机（begin → update → end/cancel）
   * 2. displacement 作为无状态增量直接累加到对象位置
   * 3. 两者可在同一帧并存：position 先算，displacement 再叠，锚点跟随位移
   * @param {ModifyGestureInteraction} interaction - 当前交互上下文
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {import("../../shared/types.js").LightweightObjectEntry[]} objects - 活动对象
   * @private
   */
  _handleSpatialUpdate(interaction, context, objects) {
    // Step 1: Position 处理（手势状态机）
    if (interaction.position) {
      if (!this.isGestureActive) {
        // 首次位置：准入检测 → begin + update
        if (this.canBeginGesture(interaction) === false) return;
        this.withGeometryMutation(
          context,
          () => {
            this.beginGesture(interaction);
            this.updateGesture(interaction);
          },
          objects,
        );
        this.isGestureActive = true;
      } else {
        // 后续位置：仅 update，无需重复抓取快照
        this.withGeometryMutation(
          context,
          () => {
            this.updateGesture(interaction);
          },
          objects,
          { captureSnapshot: false },
        );
      }
    }

    // Step 2: Displacement 处理（无状态，直接累加）
    if (interaction.displacement) {
      this.withGeometryMutation(
        context,
        () => {
          this.onBeforeDisplacement(interaction);
          this.applyDisplacementToObjects(interaction);
        },
        objects,
        { captureSnapshot: false },
      );
      this.onAfterDisplacement(interaction);
    }

    // Step 3: End 检查
    if (interaction.hasEndSignal) {
      this.completeGesture(interaction);
      this.isGestureActive = false;
    }
  }

  /**
   * 手势准入检查，决定是否允许开始修改手势，子类可覆写以添加区域命中检测等限制
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean}
   * @protected
   */
  canBeginGesture(interaction) {
    return true;
  }

  /**
   * 修改手势开始
   * @param {Object} interaction - 当前交互上下文
   * @abstract
   */
  beginGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 修改手势更新
   * @param {Object} interaction - 当前交互上下文
   * @abstract
   */
  updateGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 修改手势完成
   * @param {Object} interaction - 当前交互上下文
   */
  completeGesture(interaction) {}

  /**
   * 修改手势取消
   * @description
   * 子类应覆写此方法将对象回滚到手势开始时的初始状态。
   * 基类 _handleCancel 已包裹 withGeometryMutation，
   * 覆写时只需恢复几何，无需关心引用失效与渲染刷新。
   * @param {Object} interaction - 当前交互上下文
   */
  cancelGesture(interaction) {}

  /**
   * 位移应用前的 hook
   * @description 在每次 displacement 应用到对象前调用。子类可在此记录初始位置供 cancel 回退。
   * 已在 withGeometryMutation 的 snapshot 管理内，无需手动处理失效与渲染。
   * @param {ModifyGestureInteraction} interaction - 当前交互上下文
   * @protected
   */
  onBeforeDisplacement(interaction) {}

  /**
   * 位移应用后的 hook
   * @description 在 displacement 应用到对象后调用。子类可在此同步基准位置以保持光标-对象偏移不变。
   * 不应调整锚点——锚点固定为手势起始光标位置，调锚点会重置偏移导致瞬移。
   * 不包裹 withGeometryMutation，因此方法已在外层 snapshot 范围外。
   * @param {ModifyGestureInteraction} interaction - 当前交互上下文
   * @protected
   */
  onAfterDisplacement(interaction) {}

  /**
   * 将 displacement 增量直接累加到各对象位置
   * @description 基类默认实现：对每个活动对象，position 直接加上 displacement 向量。
   * 子类可覆写以支持非平移类修改（如旋转、缩放）。
   * @param {ModifyGestureInteraction} interaction - 当前交互上下文
   * @protected
   */
  applyDisplacementToObjects(interaction) {
    const { context, objects, displacement } = interaction;
    if (!displacement) return;
    for (const obj of objects) {
      const currentPos = this.resolveModifiedObjectPosition(obj);
      if (!currentPos) continue;
      this.setModifiedObjectPosition(context, obj, {
        x: currentPos.x + displacement.x,
        y: currentPos.y + displacement.y,
      });
    }
  }

  /**
   * 工具节点被卸载时清理手势状态
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
    this.isActionActive = false;
    this.isGestureActive = false;
    super.umount(context);
  }

  /**
   * 重置工具状态，清除当前手势
   * @returns {void}
   */
  reset() {
    this.isGestureActive = false;
    super.reset();
  }
}

export {
  OBJECT_MODIFIER_SIGNAL_TYPES,
  ObjectModifierTool,
  GestureBasedObjectModifierTool,
};
