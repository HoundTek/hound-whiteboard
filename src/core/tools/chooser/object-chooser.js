/**
 * @file 对象选择工具
 * @description 提供对象命中选择与选择结果输出的工具基类。
 * @module core/tools/chooser/object-chooser
 * @author Zhou Chenyu
 */

import { Tool } from "../tool.js";
import { SignalPacket } from "../../devices-dag/signal.js";
import { RectangleRange, intersectsRanges } from "../../range/index.js";
import { Range } from "../../range/range.js";
import { Vector } from "../../utils/math.js";

/**
 * 对象选择工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 对象选择工具负责根据命中规则挑选对象，并输出选择结果或选择范围。
 * @author Zhou Chenyu
 */
class ObjectChooserTool extends Tool {
  /**
   * @param {{}} [options={}] - 配置选项
   */
  constructor(options = {}) {
    super();
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

    // 兜底：使用 boundingBox 计算世界范围
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
   * @param {{ deviceContext?: Object, renderer?: Object }} [overlayContext={}] - overlay 上下文
   * @returns {Array<Object>}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    const context = overlayContext.deviceContext ?? {};
    const renderer = overlayContext.renderer;
    const objects = this.resolveContextObjects(context).filter(Boolean);

    if (objects.length === 0) {
      return [];
    }

    const defaultLeaf =
      typeof context.dag?.resolveDefaultLeaf === "function" &&
      typeof context.path === "string"
        ? context.dag.resolveDefaultLeaf(context.path)
        : null;

    const childObjects =
      defaultLeaf && defaultLeaf.path !== context.path
        ? this.normalizeObjectCollection(
            defaultLeaf.state?.objects ?? [],
          ).filter(Boolean)
        : [];

    if (childObjects.length > 0) {
      return [];
    }

    if (
      typeof renderer?.createCompatSelectionEntriesForSummaries !== "function"
    ) {
      return [];
    }

    return renderer.createCompatSelectionEntriesForSummaries(
      objects,
      "chooser",
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
   * 确认选择后的通知钩子
   * @description
   * 子类在手势结束时调用，handoff 通过 on('afterConfirm', ...) 订阅。
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Array<import("../../shared/types.js").ObjectSummary>} objects - 已确认的对象摘要
   * @protected
   */
  afterConfirmSelection(context, objects) {
    this._emit("afterConfirm", context, objects);
  }

  /**
   * 显式确认当前选择
   * @description
   * 子类（如 RectangleObjectChooserTool）在手势完成（end 信号）时调用，
   * 触发 beforeConfirm / afterConfirm 生命周期钩子。
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
   * 处理选择手势信号：position → 更新选择区域，end → 提交，cancel → 清理
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void|Promise<void>}
   */
  process(signalPacket, context = {}) {
    const packet = SignalPacket.from(signalPacket);

    if (packet.signals.some((s) => s.type === "cancel")) {
      this.clearSelectionRegion(context);
      this.requestUiOverlayRefresh(context);
      return;
    }

    const position = this._resolvePosition(packet, context);
    if (position) {
      this.updateSelectionRegion(position, context);
      this.requestUiOverlayRefresh(context);
    }

    if (
      packet.signals.some((s) => s.type === "end") &&
      this.hasSelectionRegion(context)
    ) {
      return this._finalizeSelection(context);
    }
  }

  /**
   * 从信号包中提取位置坐标
   * @param {SignalPacket} packet - 已解析的信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {Vector|null}
   * @private
   */
  _resolvePosition(packet, context = {}) {
    const positionSignal = packet.signals.find((s) => s.type === "position");
    return Vector.parse(
      positionSignal?.context?.value ?? positionSignal?.context?.position,
    );
  }

  /**
   * 提交选择并完成选择生命周期
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void|Promise<void>}
   * @private
   */
  _finalizeSelection(context) {
    const objectsOrPromise = this.submitSelection(context);

    if (objectsOrPromise instanceof Promise) {
      return objectsOrPromise.then((objects) => {
        this._applySelection(context, objects);
      });
    }

    this._applySelection(context, objectsOrPromise);
  }

  /**
   * 将选中对象写入上下文并触发生命周期钩子
   * @description
   * 总是执行 replaceSelection（丢弃旧选择），只在有新选中时才触发 afterChoose / confirmSelection。
   * 空选择时同样会清理上一轮选择。
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {import("../../shared/types.js").ObjectSummary[]} objects - 选中对象（可能为空）
   * @returns {void}
   * @private
   */
  _applySelection(context, objects) {
    const resolvedSelection = this.replaceSelection(context, objects);
    this.clearSelectionRegion(context);
    if (resolvedSelection.length > 0) {
      this.afterChoose(resolvedSelection);
      this.confirmSelection(context, resolvedSelection);
    }
    this.requestUiOverlayRefresh(context);
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

    return boardApi.hitTest(regionRect, "intersect").then((objectIds) => {
      if (!Array.isArray(objectIds) || objectIds.length === 0) return [];
      return boardApi.queryObjects(objectIds);
    });
  }

  /**
   * 更新当前选择区域
   * @description
   * 在 position 信号到达时由 process 调用。子类应在此更新选择区域的几何形状。
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
   * @returns {Object|null}
   * @abstract
   */
  getSelectionRegion(context) {
    throw new Error("Method not implemented.");
  }

  /**
   * 工具节点被卸载时撤销当前选择
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
    this.clearSelectionRegion(context);
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
