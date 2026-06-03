/**
 * @file demo WASD 坐标工具
 * @module templates/demo/wasd-coordinate-tool
 * @author Zhou Chenyu
 */

import { Tool } from "../../core/tools/tool.js";
import { Vector } from "../../core/utils/math.js";

/**
 * Demo 专用 WASD 坐标工具
 * @class
 * @extends Tool
 * @author Zhou Chenyu
 */
class WasdCoordinateTool extends Tool {
  /**
   * 当前累计坐标
   * @type {Vector}
   */
  position;

  /**
   * 是否在更新后打印坐标
   * @type {boolean}
   */
  logPosition;

  /**
   * 坐标变更回调
   * @type {((position: Vector, signalPacket: any, deviceContext: Object) => void) | null}
   */
  onPositionChange;

  /**
   * @param {{
   *   initialPosition?: Vector | { x: number, y: number },
   *   logPosition?: boolean,
   *   onPositionChange?: (position: Vector, signalPacket: any, deviceContext: Object) => void,
   * }} [options={}]
   */
  constructor(options = {}) {
    super();
    this.position =
      options.initialPosition instanceof Vector
        ? options.initialPosition
        : new Vector(
            options.initialPosition?.x ?? 0,
            options.initialPosition?.y ?? 0,
          );
    this.logPosition = options.logPosition ?? true;
    this.onPositionChange =
      typeof options.onPositionChange === "function"
        ? options.onPositionChange
        : null;
  }

  process(signalPacket, deviceContext = {}) {
    const movementSignals = signalPacket.signals.filter(
      (signal) => signal.type === "position",
    );
    if (movementSignals.length === 0) return;

    for (const signal of movementSignals) {
      const delta = signal?.context?.value;
      if (!delta) continue;

      this.position = new Vector(
        this.position.x + (delta.x ?? 0),
        this.position.y + (delta.y ?? 0),
      );
    }

    if (this.logPosition) {
      console.log("WASD cursor:", this.position.serialize());
    }

    this.onPositionChange?.(this.position, signalPacket, deviceContext);
  }

  reset() {
    this.position = new Vector(0, 0);
  }
}

export { WasdCoordinateTool };
