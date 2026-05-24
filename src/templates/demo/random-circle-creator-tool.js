/**
 * @file demo 随机圆对象创建工具
 * @module templates/demo/random-circle-creator-tool
 * @author Zhou Chenyu
 */

import { Tool } from "../../core/tools/tool.js";
import {
  CircleObject,
  DEFAULT_CIRCLE_PROPERTY,
} from "../../core/objects/graph/circle.js";
import { Vector } from "../../core/utils/math.js";
import { KEYBOARD_DEVICE_SIGNAL_TYPES } from "../../core/devices/keyboard-device.js";

/**
 * Demo 专用随机圆对象创建工具
 * @class
 * @extends Tool
 */
class RandomCircleCreatorTool extends Tool {
  /**
   * @param {{
   *   random?: () => number,
   *   minRadius?: number,
   *   maxRadius?: number,
   *   property?: Partial<typeof DEFAULT_CIRCLE_PROPERTY>,
   * }} [options={}]
   */
  constructor(options = {}) {
    super();
    this.random =
      typeof options.random === "function" ? options.random : Math.random;
    this.minRadius = options.minRadius ?? 12;
    this.maxRadius = options.maxRadius ?? 60;
    this.property = {
      fillColor: DEFAULT_CIRCLE_PROPERTY.fillColor,
      strokeWidth: DEFAULT_CIRCLE_PROPERTY.strokeWidth,
      ...(options.property ?? {}),
    };
    this.hasCustomStrokeColor = Boolean(
      options.property && Object.hasOwn(options.property, "strokeColor"),
    );
  }

  /**
   * @type {() => number}
   */
  random;

  /**
   * @type {number}
   */
  minRadius;

  /**
   * @type {number}
   */
  maxRadius;

  /**
   * @type {Record<string, any>}
   */
  property;

  /**
   * @type {boolean}
   */
  hasCustomStrokeColor;

  createCircle(deviceContext = {}) {
    const monitor = deviceContext.monitor;
    const viewportWorldRect = monitor?.getViewportWorldRect?.();
    if (!viewportWorldRect) return undefined;

    const radiusRange = Math.max(this.maxRadius - this.minRadius, 0);
    const radius = this.minRadius + this.random() * radiusRange;
    const centerX =
      viewportWorldRect.left +
      radius +
      this.random() * Math.max(viewportWorldRect.width - radius * 2, 0);
    const centerY =
      viewportWorldRect.top +
      radius +
      this.random() * Math.max(viewportWorldRect.height - radius * 2, 0);
    const position = new Vector(centerX, centerY);
    const objectId = deviceContext.allocateObjectId?.();
    const ownerChunkId = deviceContext.resolveOwnerChunkId?.(position);

    if (objectId == null || ownerChunkId == null) return undefined;

    const circle = new CircleObject(position, objectId, ownerChunkId, radius);
    const randomStrokeColor = `hsl(${Math.floor(this.random() * 360)}, 70%, 42%)`;
    circle.setProperty({
      ...this.property,
      strokeColor: this.hasCustomStrokeColor
        ? this.property.strokeColor
        : randomStrokeColor,
    });
    return circle;
  }

  commitCircle(circle, deviceContext = {}) {
    if (!circle) return;

    const board = deviceContext.board;
    if (board?.activeObjectManager?.add && board?.activeObjectManager?.apply) {
      const objects = new Set([circle]);
      board.activeObjectManager.add(objects);
      board.activeObjectManager.apply(objects);
      return;
    }

    board?.addObject?.(circle, circle.ownerChunkId);
  }

  process(signalPacket, deviceContext = {}) {
    const shouldCreate = signalPacket.signals.some(
      (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
    );
    if (!shouldCreate) return;

    const circle = this.createCircle(deviceContext);
    this.commitCircle(circle, deviceContext);
  }

  reset() {}
}

export { RandomCircleCreatorTool };
