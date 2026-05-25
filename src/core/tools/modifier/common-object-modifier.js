/**
 * @file 通用对象修改工具
 * @description 仅用于修改对象的位置和变换属性，适用于所有的对象类型。
 * @module core/tools/modifier/common-object-modifier
 * @author Zhou Chenyu
 */

import { Matrix, Vector } from "../../utils/math.js";
import { SignalPacket } from "../../devices/signal.js";
import {
  ObjectModifierTool,
  OBJECT_MODIFIER_SIGNAL_TYPES,
} from "./obj-modifier.js";

/**
 * 通用对象修改工具类
 * @class
 * @author Zhou Chenyu
 */
class CommonObjectModifierTool extends ObjectModifierTool {
  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);
    const positionSignal = packet.signals.find(
      (signal) => signal.type === "position",
    );
    const transformSignal = packet.signals.find(
      (signal) => signal.type === "transform",
    );
    const hasApplySignal = packet.signals.some(
      (signal) => signal.type === OBJECT_MODIFIER_SIGNAL_TYPES.APPLY,
    );

    const position = this.normalizeAbsolutePosition(
      positionSignal?.context?.value ?? positionSignal?.context,
    );
    const transform = this.normalizeAbsoluteTransform(
      transformSignal?.context?.value ?? transformSignal?.context,
    );

    if (!position && !transform && !hasApplySignal) {
      return;
    }

    const modificationContext = {
      ...deviceContext,
      objects:
        deviceContext.objects ??
        (deviceContext.object ? [deviceContext.object] : undefined) ??
        this.resolveContextObjects(deviceContext),
    };

    const objects = this.resolveActiveModifiedObjects(modificationContext);
    if (objects.length === 0) {
      return;
    }

    this.setContextObjects(modificationContext, objects);

    if (position || transform) {
      this.withGeometryMutation(
        modificationContext,
        () => {
          for (const obj of objects) {
            if (position) {
              obj.position = position;
            }
            if (transform && typeof obj.setTransform === "function") {
              obj.setTransform(transform);
            } else if (transform) {
              obj.transform = transform;
            }
          }
        },
        objects,
      );
    }

    if (hasApplySignal) {
      this.applyModifiedObjects(modificationContext, objects);
    }
  }

  reset() {}

  normalizeAbsolutePosition(value) {
    if (!value) return null;
    if (value instanceof Vector) return value;
    if (typeof value.x === "number" && typeof value.y === "number") {
      return new Vector(value.x, value.y);
    }
    return null;
  }

  normalizeAbsoluteTransform(value) {
    if (!value) return null;
    if (value instanceof Matrix) return value;
    if (
      typeof value.a === "number" &&
      typeof value.b === "number" &&
      typeof value.c === "number" &&
      typeof value.d === "number"
    ) {
      return new Matrix(value.a, value.b, value.c, value.d);
    }
    return null;
  }
}

export { CommonObjectModifierTool };
