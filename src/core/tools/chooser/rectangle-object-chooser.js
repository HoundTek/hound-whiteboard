/**
 * @file 矩形框选工具
 * @description 提供基于拖拽矩形范围的对象选择工具。
 * @module core/tools/chooser/rectangle-object-chooser
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../../devices-dag/signal.js";
import { RectangleRange } from "../../range/index.js";
import { Vector } from "../../utils/math.js";
import { ObjectChooserTool } from "./object-chooser.js";
import { BasicObject } from "../../objects/basic-obj.js";

const RECTANGLE_SELECTION_OVERLAY_STROKE_STYLE = "#33a1ff";
const RECTANGLE_SELECTION_OVERLAY_FILL_STYLE = "rgba(51, 161, 255, 0.14)";
const RECTANGLE_SELECTION_OVERLAY_LINE_WIDTH = 1;
const RECTANGLE_SELECTION_OVERLAY_LINE_DASH = Object.freeze([4, 4]);

/**
 * 矩形框选拖拽状态
 * @typedef {Object} RectangleSelectionDragState
 * @property {boolean} isSelecting - 当前是否已进入拖拽选择手势
 * @property {Vector | null} startPosition - 拖拽起点
 * @property {Vector | null} currentPosition - 最近一次位置
 * @property {RectangleRange | undefined} worldRect - 当前框选矩形
 */

/**
 * 矩形框选对象选择工具
 * @class
 * @author Zhou Chenyu
 * @extends ObjectChooserTool
 * @description
 * 通过拖拽一个矩形范围来选择对象的工具。
 * 用户通过手势拖动来创建一个矩形选择框，
 * 松开时选中框内的对象。
 */
class RectangleObjectChooserTool extends ObjectChooserTool {
  /**
   * @returns {void}
   */
  reset() {}

  /**
   * 根据拖拽起止点生成当前框选矩形
   * @param {Vector} startPosition - 起点
   * @param {Vector} endPosition - 终点
   * @returns {RectangleRange | undefined}
   */
  createSelectionWorldRect(startPosition, endPosition) {
    const start = Vector.parse(startPosition);
    const end = Vector.parse(endPosition);

    if (!start || !end) {
      return undefined;
    }

    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x);
    const bottom = Math.max(start.y, end.y);

    return new RectangleRange(left, top, right - left, bottom - top);
  }

  /**
   * 从节点 state 读取当前拖拽状态
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {RectangleSelectionDragState}
   */
  resolveSelectionDragState(context = {}) {
    const nodeState = this.resolveNodeState(context);

    return {
      isSelecting: Boolean(nodeState.isSelecting),
      startPosition: Vector.parse(nodeState.selectionStart),
      currentPosition: Vector.parse(nodeState.selectionCurrent),
      worldRect: RectangleRange.fromRectLike(nodeState.selectionWorldRect),
    };
  }

  /**
   * 将拖拽状态写回当前工具节点
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {Partial<RectangleSelectionDragState>} [dragState={}] - 新拖拽状态
   * @returns {Object}
   */
  writeSelectionDragState(context = {}, dragState = {}) {
    const nodeState = this.resolveNodeState(context);

    return this.writeNodeState(context, {
      ...nodeState,
      isSelecting: Boolean(dragState.isSelecting),
      selectionStart: dragState.startPosition ?? undefined,
      selectionCurrent: dragState.currentPosition ?? undefined,
      selectionWorldRect: dragState.worldRect ?? undefined,
    });
  }

  /**
   * 清空当前工具节点中的拖拽状态
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  clearSelectionDragState(context = {}) {
    const nodeState = { ...this.resolveNodeState(context) };

    delete nodeState.isSelecting;
    delete nodeState.selectionStart;
    delete nodeState.selectionCurrent;
    delete nodeState.selectionWorldRect;

    this.writeNodeState(context, nodeState);
  }

  /**
   * 汇总当前可参与框选的对象集合
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {Array<BasicObject>}
   */
  collectSelectableObjects(context = {}) {
    const boardCore = context.acc?.boardApi?.getBoardCore?.();
    const board = context.acc?.board;
    const objectLoaded = boardCore?.objectLoaded ?? board?.objectLoaded;
    const activeObjectIndex =
      boardCore?.activeObjectManager?.activeObjectIndex ??
      board?.activeObjectManager?.activeObjectIndex;
    const objectMap = new Map();

    for (const entry of objectLoaded?.values?.() ?? []) {
      const objectInstance = entry?.obj;
      if (!objectInstance?.id) continue;
      objectMap.set(objectInstance.id, objectInstance);
    }

    for (const objectInstance of activeObjectIndex?.values?.() ?? []) {
      if (!objectInstance?.id) continue;
      objectMap.set(objectInstance.id, objectInstance);
    }

    return [...objectMap.values()].sort((left, right) => left.id - right.id);
  }

  /**
   * 从候选对象里筛出与当前框选矩形相交的对象
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {RectangleRange} worldRect - 当前框选矩形
   * @returns {Array<BasicObject>}
   */
  selectObjectsInWorldRect(context = {}, worldRect) {
    const normalizedSelectionRect = RectangleRange.fromRectLike(worldRect);
    if (!normalizedSelectionRect) {
      return [];
    }

    return this.collectSelectableObjects(context).filter((objectInstance) =>
      this.objectIntersectsSelectionRange(
        context,
        objectInstance,
        normalizedSelectionRect,
      ),
    );
  }

  /**
   * 用新的框选结果替换当前选择
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {Array<BasicObject>} [nextObjects=[]] - 新选择结果
   * @returns {Array<BasicObject>}
   */
  replaceSelection(context = {}, nextObjects = []) {
    const previousObjects = this.resolveContextObjects(context).filter(Boolean);
    const boardApi = context.acc?.boardApi;
    const previousIds = this.resolveObjectIds(context, previousObjects);
    if (boardApi && previousIds.length > 0) {
      boardApi.discardActiveObjects(previousIds);
    } else if (previousObjects.length > 0) {
      context.acc?.board?.activeObjectManager?.discard?.(
        new Set(previousObjects),
      );
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
    } else {
      context.acc?.board?.activeObjectManager?.choose?.(
        new Set(resolvedNextObjects),
      );
    }
    return this.setContextObjects(context, resolvedNextObjects);
  }

  /**
   * 收集矩形框选工具当前声明的 overlay
   * @param {{ deviceContext?: Object }} [overlayContext={}]
   * @returns {Array<Object>}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    const entries = [...super.collectUiOverlayEntries(overlayContext)];
    const dragState = this.resolveSelectionDragState(
      overlayContext.deviceContext ?? {},
    );

    if (!dragState.worldRect) {
      return entries;
    }

    entries.push({
      source: "rectangle-selection-drag",
      type: "rect",
      worldRect: dragState.worldRect,
      fillStyle: RECTANGLE_SELECTION_OVERLAY_FILL_STYLE,
      strokeStyle: RECTANGLE_SELECTION_OVERLAY_STROKE_STYLE,
      lineWidth: RECTANGLE_SELECTION_OVERLAY_LINE_WIDTH,
      lineDash: [...RECTANGLE_SELECTION_OVERLAY_LINE_DASH],
    });

    return entries;
  }

  /**
   * 处理矩形框选手势
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, context = {}) {
    const packet = SignalPacket.from(signalPacket);
    const positionSignal = packet.signals.find(
      (signal) => signal.type === "position",
    );
    const position = Vector.parse(
      positionSignal?.context?.value ?? positionSignal?.context?.position,
    );
    const isGestureEnded = packet.signals.some(
      (signal) => signal.type === "end",
    );
    const isGestureCancelled = packet.signals.some(
      (signal) => signal.type === "cancel",
    );
    const dragState = this.resolveSelectionDragState(context);
    let nextDragState = dragState;

    if (isGestureCancelled) {
      if (dragState.isSelecting || dragState.worldRect) {
        this.clearSelectionDragState(context);
        this.requestUiOverlayRefresh(context);
      }
      return;
    }

    if (position) {
      const startPosition = dragState.startPosition ?? position;
      nextDragState = {
        isSelecting: true,
        startPosition,
        currentPosition: position,
        worldRect: this.createSelectionWorldRect(startPosition, position),
      };

      // `button/buttons` 这类设备语义已在 mouse 设备路由阶段被消费
      // 工具节点只根据“自己已收到的位置/结束信号”维护工作流
      this.writeSelectionDragState(context, nextDragState);
      this.requestUiOverlayRefresh(context);
    }

    if (!isGestureEnded || !nextDragState.startPosition) {
      return;
    }

    // 手势结束时，使用最后一次已知拖拽矩形提交新的选择结果
    const selectionWorldRect = this.createSelectionWorldRect(
      nextDragState.startPosition,
      position ?? nextDragState.currentPosition ?? nextDragState.startPosition,
    );
    const selectedObjects = this.selectObjectsInWorldRect(
      context,
      selectionWorldRect,
    );

    this.replaceSelection(context, selectedObjects);
    this.clearSelectionDragState(context);
    this.afterChoose(selectedObjects);
    this.confirmSelection(context, selectedObjects);
    this.requestUiOverlayRefresh(context);
  }

  /**
   * 卸载工具时清理拖拽状态和当前选择
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
    this.clearSelectionDragState(context);
    super.umount(context);
  }
}

export { RectangleObjectChooserTool };
