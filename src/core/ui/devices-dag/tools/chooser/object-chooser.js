/**
 * @file 对象选择工具
 * @description 提供对象命中选择与选择结果输出的工具基类。
 * @module core/ui/devices-dag/tools/chooser/object-chooser
 * @author Zhou Chenyu
 */

import { GestureTool, unifyActionResult } from "../gesture-tool.js";
import { RectangleRange, intersectsRanges } from "../../../../shared/range/index.js";
import { Range } from "../../../../shared/range/range.js";
import { Vector } from "../../../../utils/math.js";
import { createCompatSelectionEntriesForSummaries } from "../../../../shared/renderer/ui-overlay-factory.js";

/**
 * 对象选择工具基类
 * @class
 * @abstract
 * @extends GestureTool
 * @description
 * 对象选择工具负责根据命中规则挑选对象，并输出选择结果或选择范围。
 * @author Zhou Chenyu
 */
class ObjectChooserTool extends GestureTool {
  /**
   * overlay 渲染用——当前选中的对象摘要
   * @type {import("../../shared/types.js").ObjectSummary[]}
   * @protected
   */
  _overlaySelectedObjects = [];

  /**
   * @param {{}} [options={}] - 配置选项
   */
  constructor(options = {}) {
    super();
    this.autoActionOnGestureEnd = true;
  }

  /**
   * Chooser 的 completeAction 可能返回 Promise（异步框选）
   * @returns {boolean}
   */
  get hasAsyncCompleteAction() {
    return true;
  }

  /**
   * 将选择条目回填为真实对象实例（若可解析）
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {import("../../shared/types.js").ObjectSummary} objectEntry - 对象摘要
   * @returns {import("../../shared/types.js").ObjectSummary}
   * @protected
   */
  resolveSelectedObjectReference(context = {}, objectEntry) {
    return objectEntry;
  }

  /**
   * 批量回填选择条目为真实对象实例（若可解析）
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {Iterable<import("../../shared/types.js").ObjectSummary>|import("../../shared/types.js").ObjectSummary} objects - 对象摘要或摘要集合
   * @returns {Array<import("../../shared/types.js").ObjectSummary>}
   * @protected
   */
  resolveSelectedObjectReferences(context = {}, objects) {
    return this.normalizeObjectCollection(objects)
      .map((objectEntry) =>
        this.resolveSelectedObjectReference(context, objectEntry),
      )
      .filter(Boolean);
  }

  /**
   * 解析对象主判定范围在世界空间中的范围
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {import("../../shared/types.js").ObjectSummary} objectEntry - 候选对象摘要
   * @returns {Range | undefined}
   */
  resolveObjectSelectionWorldRange(context = {}, objectEntry) {
    const position = Vector.parse(objectEntry?.position);
    if (!position) {
      return undefined;
    }

    const localRange = objectEntry?.range;
    if (localRange && typeof localRange.withPosition === "function") {
      return localRange.withPosition(position);
    }

    const localBoundingBox = objectEntry?.boundingBox;
    if (localBoundingBox) {
      const worldBoundingBox = RectangleRange.fromRectLike(localBoundingBox);
      if (
        worldBoundingBox &&
        typeof worldBoundingBox.withPosition === "function"
      ) {
        return worldBoundingBox.withPosition(position);
      }
    }

    return undefined;
  }

  /**
   * 判断对象主判定范围是否与给定选择范围相交
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {import("../../shared/types.js").ObjectSummary} objectEntry - 候选对象摘要
   * @param {Range} selectionWorldRange - 选择范围
   * @returns {boolean}
   */
  objectIntersectsSelectionRange(
    context = {},
    objectEntry,
    selectionWorldRange,
  ) {
    const objectWorldRange = this.resolveObjectSelectionWorldRange(
      context,
      objectEntry,
    );
    if (!objectWorldRange || !selectionWorldRange) {
      return false;
    }

    return intersectsRanges(objectWorldRange, selectionWorldRange);
  }

  /**
   * 收集 chooser 当前声明的兼容 ui overlay
   * @param {{
   *   viewport?: import("../../components/orchestration/viewport.js").Viewport,
   *   renderer?: import("../../components/renderer/ui-renderer.js").UiRenderer,
   *   deviceContext?: import("../../devices-dag/dag.js").DevicesDAGHandlerContext,
   * }} [overlayContext={}] - overlay 上下文
   * @returns {import("../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    const { viewport, renderer } = overlayContext;
    const objects = this._overlaySelectedObjects;

    if (objects.length === 0 || !renderer?.drawRectEntry) {
      return [];
    }

    return createCompatSelectionEntriesForSummaries(
      objects,
      "chooser",
      viewport,
      (ctx, entry) => renderer.drawRectEntry(ctx, entry),
    );
  }

  /**
   * 选择完成后的通知钩子
   * @description
   * 每次成功选择对象后触发，handoff 可通过 on('afterChoose', ...) 订阅。
   * @param {Array<import("../../shared/types.js").ObjectSummary>} objects - 被选中的对象摘要
   * @protected
   */
  afterChoose(objects) {
    this._emit("afterChoose", objects);
  }

  /**
   * 决定是否确认当前选择钩子
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {boolean}
   * @protected
   */
  beforeConfirmSelection(context) {
    return true;
  }

  /**
   * 确认选择后的扩展钩子
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Array<import("../../shared/types.js").ObjectSummary>} objects - 已确认的对象摘要
   * @returns {void}
   * @protected
   */
  afterConfirmSelection(context, objects) { }

  /**
   * 显式确认当前选择
   * @description
   * 子类（如 RectangleObjectChooserTool）在手势完成（end 信号）时调用，
   * 触发选择确认校验与确认后的扩展钩子。
   * 与 creator 的 completeCreatedObject、modifier 的 applyModifiedObjects
   * 构成统一的完成确认语义入口。
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Array<import("../../shared/types.js").ObjectSummary>} objects - 待确认的对象摘要
   * @returns {boolean}
   */
  confirmSelection(context, objects) {
    if (this.beforeConfirmSelection(context) === false) return false;
    this.afterConfirmSelection(context, objects);
    return true;
  }

  /**
   * 选择手势开始钩子
   * @param {Object} interaction - 当前交互上下文
   * @returns {void}
   * @protected
   */
  beginSelectionGesture(interaction) { }

  /**
   * GestureTool 生命周期适配：开始选择手势
   * @param {Object} interaction - 当前交互上下文
   * @returns {void}
   */
  beginGesture(interaction) {
    this.beginSelectionGesture(interaction);
  }

  /**
   * GestureTool 生命周期适配：更新选择手势
   * @param {Object} interaction - 当前交互上下文
   * @returns {void}
   */
  updateGesture(interaction) {
    if (!interaction.position) {
      return;
    }

    this.updateSelectionRegion(interaction.position, interaction.context);
    this.requestUiOverlayRefresh(interaction.context);
  }

  /**
   * GestureTool 生命周期适配：完成选择手势
   * @param {Object} interaction - 当前交互上下文
   * @returns {void}
   */
  completeGesture(interaction) { }

  /**
   * GestureTool 生命周期适配：取消选择手势
   * @param {Object} interaction - 当前交互上下文
   * @returns {void}
   */
  cancelGesture(interaction) {
    this.clearSelectionRegion(interaction.context);
  }

  /**
   * 自定义 cancel 语义
   * @description 取消当前拖拽区域和上一轮已确认的选择，重置选择状态。
   * @param {Object} interaction - 当前交互上下文
   * @returns {void}
   * @protected
   */
  _onCancel(interaction) {
    if (this.isGestureActive) {
      this.cancelGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:cancel", interaction);
    }

    this.cancelAction(interaction.context);
    return undefined;
  }

  /**
   * 自定义 end 语义
   * @description end 期间需要保留当前选择区域供 submitSelection 使用，不能走基类的预清理逻辑。
   * @param {Object} interaction - 当前交互上下文
   * @returns {Array<import("../../shared/types.js").ObjectSummary>|Promise<Array<import("../../shared/types.js").ObjectSummary>>|undefined}
   * @protected
   */
  _onEnd(interaction) {
    if (this.isGestureActive) {
      this.completeGesture(interaction);
      this.isGestureActive = false;
      this._emit("gesture:end", interaction);
    }

    if (!this.hasSelectionRegion(interaction.context)) {
      return undefined;
    }

    return this.completeAction(interaction.context);
  }

  /**
   * GestureTool 生命周期适配：确认前校验
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {boolean}
   * @protected
   */
  beforeAction(context) {
    return this.beforeConfirmSelection(context);
  }

  /**
   * GestureTool 生命周期适配：提交选择结果
   * @description
   * 选择动作允许异步提交，因此此处覆写 completeAction，用 unifyActionResult 统一同步/异步路径。
   * 仅在 confirmSelection 成功时发送 `action:complete`。
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {Array<import("../../shared/types.js").ObjectSummary>|Promise<Array<import("../../shared/types.js").ObjectSummary>>}
   */
  completeAction(context) {
    return unifyActionResult(this.submitSelection(context), (objects) =>
      this._applySelection(context, objects),
    );
  }

  /**
   * 将选中对象写入上下文并按需触发生命周期钩子
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {import("../../shared/types.js").ObjectSummary[]} objects - 选中对象
   * @returns {Array<import("../../shared/types.js").ObjectSummary>}
   * @private
   */
  _applySelection(context, objects) {
    const resolvedSelection = this.replaceSelection(context, objects);
    this.clearSelectionRegion(context);
    this._overlaySelectedObjects = resolvedSelection;

    if (resolvedSelection.length > 0) {
      this.afterChoose(resolvedSelection);
      if (this.confirmSelection(context, resolvedSelection) !== false) {
        super.afterAction(context, resolvedSelection);
      }
    }

    this.requestUiOverlayRefresh(context);
    return resolvedSelection;
  }

  /**
   * GestureTool 生命周期适配：清理 overlay 临时状态
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   * @protected
   */
  clearOverlayState(context = {}) {
    this._overlaySelectedObjects = [];
    this.requestUiOverlayRefresh(context);
  }

  /**
   * GestureTool 生命周期适配：撤销当前已激活选择
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   * @protected
   */
  discardAction(context = {}) {
    const selectedObjects = this.resolveContextObjects(context);
    const boardApi = context?.acc?.boardApi;
    const objectIds = this.resolveObjectIds(context, selectedObjects);
    if (boardApi && objectIds.length > 0) {
      boardApi.discardActiveObjects(objectIds);
    }
    this.clearContextObjects(context);
  }

  /**
   * 用新的选择结果替换当前选择
   * @description
   * 丢弃旧选择、激活新对象、写回设备上下文与节点状态。
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {import("../../shared/types.js").ObjectSummary[]} [nextObjects=[]] - 新选择结果
   * @returns {import("../../shared/types.js").ObjectSummary[]}
   */
  replaceSelection(context = {}, nextObjects = []) {
    const previousObjects = this.resolveContextObjects(context).filter(Boolean);
    const boardApi = context.acc?.boardApi;
    const previousIds = this.resolveObjectIds(context, previousObjects);
    if (boardApi && previousIds.length > 0) {
      boardApi.discardActiveObjects(previousIds);
    }

    this.clearContextObjects(context);

    const resolvedNextObjects = this.resolveSelectedObjectReferences(
      context,
      nextObjects,
    );

    if (resolvedNextObjects.length === 0) {
      return [];
    }

    const nextIds = this.resolveObjectIds(context, resolvedNextObjects);
    if (boardApi && nextIds.length > 0) {
      boardApi.addActiveObjects(nextIds);
    }
    return this.setContextObjects(context, resolvedNextObjects);
  }

  /**
   * 提交选择——用当前选择区域命中检测并返回对象摘要
   * @description
   * 默认实现使用 getSelectionRegion 获取区域，走 boardApi.hitTest + queryObjects。
   * 子类可直接覆写此方法以提供自定义选择逻辑。
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {import("../../shared/types.js").ObjectSummary[]|Promise<import("../../shared/types.js").ObjectSummary[]>}
   */
  submitSelection(context) {
    const region = this.getSelectionRegion(context);
    if (!region) return [];

    const boardApi = context.acc?.boardApi;
    if (!boardApi) return [];

    const regionRect = RectangleRange.fromRectLike(region);
    if (!regionRect) return [];

    // 等到 boardApi.hitTest 完成后再 queryObjects
    return boardApi.hitTest(regionRect, "intersect").then((objectIds) => {
      if (!Array.isArray(objectIds) || objectIds.length === 0) return [];
      return boardApi.queryObjects(objectIds);
    });
  }

  /**
   * 更新当前选择区域
   * @description
   * 在 position 信号到达时由 GestureTool 调用。子类应在此更新选择区域的几何形状。
   * @param {Vector} position - 最新位置
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   * @abstract
   */
  updateSelectionRegion(position, context) {
    throw new Error("Method not implemented.");
  }

  /**
   * 当前是否已有有效的选择区域
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {boolean}
   * @abstract
   */
  hasSelectionRegion(context) {
    throw new Error("Method not implemented.");
  }

  /**
   * 清理当前选择区域
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   * @abstract
   */
  clearSelectionRegion(context = {}) {
    throw new Error("Method not implemented.");
  }

  /**
   * 获取当前选择区域（供默认 submitSelection 使用）
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {RectangleRange|null}
   * @abstract
   */
  getSelectionRegion(context) {
    throw new Error("Method not implemented.");
  }

  /**
   * 处理一个完整信号包
   * @description
   * 在交给 GestureTool 路由前，先同步清理已失效的 overlay 选择状态，
   * 避免 handoff 清空 nodeState 后显示旧选中框。
   * @param {Object} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void|Promise<void>}
   */
  process(signalPacket, context = {}) {
    if (
      this._overlaySelectedObjects.length > 0 &&
      !this.resolveNodeState(context).objects
    ) {
      this._overlaySelectedObjects = [];
    }

    return super.process(signalPacket, context);
  }

  /**
   * 工具节点被卸载时撤销当前选择
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
    this.isActionActive = false;
    this.clearSelectionRegion(context);
    this._overlaySelectedObjects = [];
    const selectedObjects = this.resolveContextObjects(context);
    const boardApi = context?.acc?.boardApi;
    const objectIds = this.resolveObjectIds(context, selectedObjects);
    if (boardApi && objectIds.length > 0) {
      boardApi.discardActiveObjects(objectIds);
    }
    this.clearContextObjects(context);
    super.umount(context);
  }
}

export { ObjectChooserTool };
