/**
 * @file 矩形框选工具
 * @description 提供基于拖拽矩形范围的对象选择工具。
 * @module core/tools/chooser/rectangle-object-chooser
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../../devices/signal.js";
import { intersectsRanges, RectangleRange } from "../../range/index.js";
import { Vector } from "../../utils/math.js";
import { ObjectChooserTool } from "./obj-chooser.js";

const RECTANGLE_SELECTION_OVERLAY_STROKE_STYLE = "#33a1ff";
const RECTANGLE_SELECTION_OVERLAY_FILL_STYLE = "rgba(51, 161, 255, 0.14)";
const RECTANGLE_SELECTION_OVERLAY_LINE_WIDTH = 1;
const RECTANGLE_SELECTION_OVERLAY_LINE_DASH = Object.freeze([4, 4]);

class RectangleObjectChooserTool extends ObjectChooserTool {
  static normalizeVector(value) {
    if (!value) return null;
    if (value instanceof Vector) return value;
    if (typeof value.x === "number" && typeof value.y === "number") {
      return new Vector(value.x, value.y);
    }
    return null;
  }

  choose() {
    return [];
  }

  reset() {}

  isSecondaryPressed(buttons) {
    return typeof buttons === "number" && (buttons & 2) === 2;
  }

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

  clearSelectionDragState(deviceContext = {}) {
    const nodeState = { ...this.resolveNodeState(deviceContext) };

    delete nodeState.isSelecting;
    delete nodeState.selectionStart;
    delete nodeState.selectionCurrent;
    delete nodeState.selectionWorldRect;

    this.writeNodeState(deviceContext, nodeState);
  }

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

  resolveObjectWorldRect(deviceContext = {}, objectInstance) {
    if (!objectInstance) return undefined;

    const worldRect =
      deviceContext.board?.activeObjectManager?.getObjectWorldRange?.(
        objectInstance,
      ) ?? objectInstance?.getRange?.()?.withPosition?.(objectInstance.position);

    return RectangleRange.from(worldRect);
  }

  selectObjectsInWorldRect(deviceContext = {}, worldRect) {
    const normalizedSelectionRect = RectangleRange.fromRectLike(worldRect);
    if (!normalizedSelectionRect) {
      return [];
    }

    return this.collectSelectableObjects(deviceContext).filter((objectInstance) => {
      const objectWorldRect = this.resolveObjectWorldRect(
        deviceContext,
        objectInstance,
      );
      return objectWorldRect && intersectsRanges(objectWorldRect, normalizedSelectionRect);
    });
  }

  replaceSelection(deviceContext = {}, nextObjects = []) {
    const previousObjects = this.resolveContextObjects(deviceContext).filter(Boolean);
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

  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);
    const positionSignal = packet.signals.find(
      (signal) => signal.type === "position",
    );
    const position = RectangleObjectChooserTool.normalizeVector(
      positionSignal?.context?.value ?? positionSignal?.context?.position,
    );
    const isGestureEnded = packet.signals.some((signal) => signal.type === "end");
    const isGestureCancelled = packet.signals.some(
      (signal) => signal.type === "cancel",
    );
    const dragState = this.resolveSelectionDragState(deviceContext);

    if (isGestureCancelled) {
      if (dragState.isSelecting || dragState.worldRect) {
        this.clearSelectionDragState(deviceContext);
        this.requestUiOverlayRefresh(deviceContext);
      }
      return;
    }

    if (position && this.isSecondaryPressed(positionSignal?.context?.buttons)) {
      const startPosition = dragState.startPosition ?? position;
      this.writeSelectionDragState(deviceContext, {
        isSelecting: true,
        startPosition,
        currentPosition: position,
        worldRect: this.createSelectionWorldRect(startPosition, position),
      });
      this.requestUiOverlayRefresh(deviceContext);
    }

    if (!isGestureEnded || !dragState.startPosition) {
      return;
    }

    const selectionWorldRect = this.createSelectionWorldRect(
      dragState.startPosition,
      position ?? dragState.currentPosition ?? dragState.startPosition,
    );
    const selectedObjects = this.selectObjectsInWorldRect(
      deviceContext,
      selectionWorldRect,
    );

    this.replaceSelection(deviceContext, selectedObjects);
    this.clearSelectionDragState(deviceContext);
    this.requestUiOverlayRefresh(deviceContext);
  }

  umount(deviceContext = {}) {
    this.clearSelectionDragState(deviceContext);
    super.umount(deviceContext);
  }
}

export { RectangleObjectChooserTool };