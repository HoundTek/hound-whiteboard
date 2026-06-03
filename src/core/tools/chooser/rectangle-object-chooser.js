/**
 * @file 矩形框选工具
 * @description 提供基于拖拽矩形范围的对象选择工具。
 * @module core/tools/chooser/rectangle-object-chooser
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../../devices-dag/signal.js";
import { RectangleRange } from "../../range/index.js";
import { Vector } from "../../utils/math.js";
import { ObjectChooserTool } from "./obj-chooser.js";

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
   * 将位置值规整为 `Vector`
   * @param {*} value - 原始位置值
   * @returns {Vector | null}
   */
  static normalizeVector(value) {
    if (!value) return null;
    if (value instanceof Vector) return value;
    if (typeof value.x === "number" && typeof value.y === "number") {
      return new Vector(value.x, value.y);
    }
    return null;
  }

  /**
   * @returns {void}
   */
  reset() {}

  /**
   * 根据拖拽起止点生成当前框选矩形
   * @param {*} startPosition - 起点
   * @param {*} endPosition - 终点
   * @returns {RectangleRange | undefined}
   */
  createSelectionWorldRect(startPosition, endPosition) {
    const start = RectangleObjectChooserTool.normalizeVector(startPosition);
    const end = RectangleObjectChooserTool.normalizeVector(endPosition);

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
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {RectangleSelectionDragState}
   */
  resolveSelectionDragState(deviceContext = {}) {
    const nodeState = this.resolveNodeState(deviceContext);

    return {
      isSelecting: Boolean(nodeState.isSelecting),
      startPosition: RectangleObjectChooserTool.normalizeVector(
        nodeState.selectionStart,
      ),
      currentPosition: RectangleObjectChooserTool.normalizeVector(
        nodeState.selectionCurrent,
      ),
      worldRect: RectangleRange.fromRectLike(nodeState.selectionWorldRect),
    };
  }

  /**
   * 将拖拽状态写回当前工具节点
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {Partial<RectangleSelectionDragState>} [dragState={}] - 新拖拽状态
   * @returns {Object}
   */
  writeSelectionDragState(deviceContext = {}, dragState = {}) {
    const nodeState = this.resolveNodeState(deviceContext);

    return this.writeNodeState(deviceContext, {
      ...nodeState,
      isSelecting: Boolean(dragState.isSelecting),
      selectionStart: dragState.startPosition ?? undefined,
      selectionCurrent: dragState.currentPosition ?? undefined,
      selectionWorldRect: dragState.worldRect ?? undefined,
    });
  }

  /**
   * 清空当前工具节点中的拖拽状态
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {void}
   */
  clearSelectionDragState(deviceContext = {}) {
    const nodeState = { ...this.resolveNodeState(deviceContext) };

    delete nodeState.isSelecting;
    delete nodeState.selectionStart;
    delete nodeState.selectionCurrent;
    delete nodeState.selectionWorldRect;

    this.writeNodeState(deviceContext, nodeState);
  }

  /**
   * 汇总当前可参与框选的对象集合
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {Array<*>}
   */
  collectSelectableObjects(deviceContext = {}) {
    const board = deviceContext.board;
    const objectMap = new Map();

    for (const entry of board?.objectLoaded?.values?.() ?? []) {
      const objectInstance = entry?.obj;
      if (!objectInstance?.id) continue;
      objectMap.set(objectInstance.id, objectInstance);
    }

    for (const objectInstance of board?.activeObjectManager?.activeObjectIndex?.values?.() ??
      []) {
      if (!objectInstance?.id) continue;
      objectMap.set(objectInstance.id, objectInstance);
    }

    return [...objectMap.values()].sort((left, right) => left.id - right.id);
  }

  /**
   * 从候选对象里筛出与当前框选矩形相交的对象
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {*} worldRect - 当前框选矩形
   * @returns {Array<*>}
   */
  selectObjectsInWorldRect(deviceContext = {}, worldRect) {
    const normalizedSelectionRect = RectangleRange.fromRectLike(worldRect);
    if (!normalizedSelectionRect) {
      return [];
    }

    return this.collectSelectableObjects(deviceContext).filter(
      (objectInstance) =>
        this.objectIntersectsSelectionRange(
          deviceContext,
          objectInstance,
          normalizedSelectionRect,
        ),
    );
  }

  /**
   * 用新的框选结果替换当前选择
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {Array<*>} [nextObjects=[]] - 新选择结果
   * @returns {Array<*>}
   */
  replaceSelection(deviceContext = {}, nextObjects = []) {
    const previousObjects =
      this.resolveContextObjects(deviceContext).filter(Boolean);
    if (previousObjects.length > 0) {
      deviceContext.board?.activeObjectManager?.discard?.(
        new Set(previousObjects),
      );
    }

    this.clearContextObjects(deviceContext);

    if (nextObjects.length === 0) {
      return [];
    }

    deviceContext.board?.activeObjectManager?.choose?.(new Set(nextObjects));
    return this.setContextObjects(deviceContext, nextObjects);
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
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);
    const positionSignal = packet.signals.find(
      (signal) => signal.type === "position",
    );
    const position = RectangleObjectChooserTool.normalizeVector(
      positionSignal?.context?.value ?? positionSignal?.context?.position,
    );
    const isGestureEnded = packet.signals.some(
      (signal) => signal.type === "end",
    );
    const isGestureCancelled = packet.signals.some(
      (signal) => signal.type === "cancel",
    );
    const dragState = this.resolveSelectionDragState(deviceContext);
    let nextDragState = dragState;

    if (isGestureCancelled) {
      if (dragState.isSelecting || dragState.worldRect) {
        this.clearSelectionDragState(deviceContext);
        this.requestUiOverlayRefresh(deviceContext);
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
      this.writeSelectionDragState(deviceContext, nextDragState);
      this.requestUiOverlayRefresh(deviceContext);
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
      deviceContext,
      selectionWorldRect,
    );

    this.replaceSelection(deviceContext, selectedObjects);
    this.clearSelectionDragState(deviceContext);
    this.afterChoose(selectedObjects);
    this.confirmSelection(deviceContext, selectedObjects);
    this.requestUiOverlayRefresh(deviceContext);
  }

  /**
   * 卸载工具时清理拖拽状态和当前选择
   * @param {Object} [deviceContext={}] - 卸载上下文
   * @returns {void}
   */
  umount(deviceContext = {}) {
    this.clearSelectionDragState(deviceContext);
    super.umount(deviceContext);
  }
}

export { RectangleObjectChooserTool };
