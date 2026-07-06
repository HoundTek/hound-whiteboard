/**
 * @file 矩形框选工具
 * @description 提供基于拖拽矩形范围的对象选择工具。
 * @module core/tools/chooser/rectangle-object-chooser
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../../range/index.js";
import { Vector } from "../../utils/math.js";
import { ObjectChooserTool } from "./object-chooser.js";

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
   * overlay 渲染用——当前框选拖拽状态
   * @type {RectangleSelectionDragState}
   * @protected
   */
  _overlayDragState = {
    isSelecting: false,
    worldRect: undefined,
  };

  /**
   * 重置矩形框选工具的临时状态
   * @override
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
   * 收集矩形框选工具当前声明的 overlay
   * @param {{
   *   viewport?: import("../../components/orchestration/viewport.js").Viewport,
   *   renderer?: import("../../components/renderer/ui-renderer.js").UiRenderer,
   * }} [overlayContext={}] - overlay 上下文
   * @returns {import("../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    const entries = [...super.collectUiOverlayEntries(overlayContext)];
    const { worldRect } = this._overlayDragState;

    if (!worldRect) {
      return entries;
    }

    entries.push({
      source: "rectangle-selection-drag",
      type: "rect",
      worldRect,
      fillStyle: RECTANGLE_SELECTION_OVERLAY_FILL_STYLE,
      strokeStyle: RECTANGLE_SELECTION_OVERLAY_STROKE_STYLE,
      lineWidth: RECTANGLE_SELECTION_OVERLAY_LINE_WIDTH,
      lineDash: [...RECTANGLE_SELECTION_OVERLAY_LINE_DASH],
    });

    return entries;
  }

  /**
   * 用新位置更新框选矩形
   * @param {Vector} position - 最新拖拽位置
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   */
  updateSelectionRegion(position, context) {
    const dragState = this.resolveSelectionDragState(context);
    const startPosition = dragState.startPosition ?? position;

    const worldRect = this.createSelectionWorldRect(startPosition, position);
    this.writeSelectionDragState(context, {
      isSelecting: true,
      startPosition,
      currentPosition: position,
      worldRect,
    });
    this._overlayDragState = { isSelecting: true, worldRect };
  }

  /**
   * 当前是否有框选矩形
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {boolean}
   */
  hasSelectionRegion(context) {
    return Boolean(this.resolveSelectionDragState(context).worldRect);
  }

  /**
   * 清理当前框选状态
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  clearSelectionRegion(context = {}) {
    this.clearSelectionDragState(context);
    this._overlayDragState = { isSelecting: false, worldRect: undefined };
  }

  /**
   * 获取当前框选矩形
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {RectangleRange|null}
   */
  getSelectionRegion(context) {
    return this.resolveSelectionDragState(context).worldRect ?? null;
  }
}

export { RectangleObjectChooserTool };
