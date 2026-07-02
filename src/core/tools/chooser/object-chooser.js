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
import { BasicObject } from "../../objects/basic-obj.js";

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
   * @param {{}} [options={}]
   */
  constructor(options = {}) {
    super();
  }

  /**
   * 从信号包构建选择上下文
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {Object}
   */
  buildSelectionContext(signalPacket, context = {}) {
    const packet = SignalPacket.from(signalPacket);
    return {
      signalPacket: packet,
      context,
      signals: packet.signals,
    };
  }

  /**
   * 将选择条目回填为真实对象实例（若可解析）
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {*} objectEntry - 对象实例或兼容条目
   * @returns {*}
   * @protected
   */
  resolveSelectedObjectReference(context = {}, objectEntry) {
    if (objectEntry instanceof BasicObject) {
      return objectEntry;
    }

    const objectId = this.resolveObjectId(objectEntry);
    if (objectId == null) {
      return objectEntry;
    }

    const boardApi = context?.acc?.boardApi;
    const boardCoreObject = boardApi?.getBoardCore?.()?.getObjectById?.(
      objectId,
    );
    if (boardCoreObject) {
      return boardCoreObject;
    }

    if (this.canUseLegacyBoardCompat(context)) {
      return context?.acc?.board?.getObjectById?.(objectId) ?? objectEntry;
    }

    return objectEntry;
  }

  /**
   * 批量回填选择条目为真实对象实例（若可解析）
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {Iterable<*>|*} objects - 对象或对象集合
   * @returns {Array<*>}
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
   * @param {BasicObject} objectEntry - 候选对象
   * @returns {Range | undefined}
   */
  resolveObjectSelectionWorldRange(context = {}, objectEntry) {
    const position = Vector.parse(objectEntry?.position);
    if (!position) {
      return undefined;
    }

    const localRange =
      objectEntry?.range ??
      (typeof objectEntry?.getRange === "function"
        ? objectEntry.getRange()
        : undefined);
    if (localRange && typeof localRange.withPosition === "function") {
      return localRange.withPosition(position);
    }

    const localBoundingBoxSource =
      objectEntry?.boundingBox ?? objectEntry?.rich?.boundingBox;
    const localBoundingBox = localBoundingBoxSource
      ? RectangleRange.from(localBoundingBoxSource)
      : undefined;
    if (
      localBoundingBox &&
      typeof localBoundingBox.withPosition === "function"
    ) {
      return localBoundingBox.withPosition(position);
    }

    return undefined;
  }

  /**
   * 判断对象主判定范围是否与给定选择范围相交
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {BasicObject} objectEntry - 候选对象
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
   * @param {{ deviceContext?: Object, renderer?: Object }} [overlayContext={}]
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
   * @param {Array<*>} objects - 被选中的对象
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
   * @param {Array<*>} objects - 已确认的对象
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
   * @param {Array<*>} objects - 待确认的对象
   * @returns {boolean}
   */
  confirmSelection(context, objects) {
    if (this.beforeConfirmSelection(context) === false) return false;
    this.afterConfirmSelection(context, objects);
    return true;
  }

  /**
   * 处理一个完整信号包
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {*}
   */
  process(signalPacket, context = {}) {
    const packet = SignalPacket.from(signalPacket);
    const selectionContext = this.buildSelectionContext(packet, context);
    const selectedObjects = this.resolveSelectedObjectReferences(
      selectionContext.context,
      this.choose(selectionContext),
    );
    if (selectedObjects.length === 0) {
      return undefined;
    }

    const boardApi = selectionContext.context.acc?.boardApi;
    const objectIds = this.resolveObjectIds(
      selectionContext.context,
      selectedObjects,
    );
    if (boardApi && objectIds.length > 0) {
      boardApi.addActiveObjects(objectIds);
    } else {
      selectionContext.context.acc?.board?.activeObjectManager?.choose?.(
        new Set(selectedObjects),
      );
    }
    this.setContextObjects(selectionContext.context, selectedObjects);
    this.afterChoose(selectedObjects);
    return undefined;
  }

  /**
   * 根据输入上下文执行对象选择
   * @param {Object} selectionContext - 选择上下文
   * @returns {*}
   */
  choose(selectionContext) {
    throw new Error("Method not implemented.");
  }

  /**
   * 工具节点被卸载时撤销当前选择
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
    const selectedObjects = this.resolveContextObjects(context);
    const boardApi = context?.acc?.boardApi;
    const objectIds = this.resolveObjectIds(context, selectedObjects);
    if (boardApi && objectIds.length > 0) {
      boardApi.discardActiveObjects(objectIds);
    } else if (selectedObjects.length > 0) {
      context?.acc?.board?.activeObjectManager?.discard?.(
        new Set(selectedObjects),
      );
    }
    this.clearContextObjects(context);
    super.umount(context);
  }
}

export { ObjectChooserTool };
