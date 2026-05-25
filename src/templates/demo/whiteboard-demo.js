/**
 * @file whiteboard demo 配置
 * @module templates/demo/whiteboard-demo
 * @author Zhou Chenyu
 */

import { createMouseDevice } from "../../core/devices/mouse-device.js";
import {
  KEYBOARD_DEVICE_SIGNAL_TYPES,
  createKeyboardDevice,
} from "../../core/devices/keyboard-device.js";
import { StrokeCreatorTool } from "../../core/tools/creator/stroke-creator.js";
import { DebuggerTool } from "./debugger-tool.js";
import { RandomCircleCreatorTool } from "./random-circle-creator-tool.js";
import { WasdCoordinateTool } from "./wasd-coordinate-tool.js";
import { MonitorViewportTool } from "./monitor-viewport-tool.js";
import { Vector } from "../../core/utils/math.js";

const DEMO_PRIMARY_STROKE_COLOR = "#000000";
const DEMO_SECONDARY_STROKE_COLOR = "#ff0000";
const DEMO_KEYBOARD_INPUT_CODES = Object.freeze([
  "Space",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "KeyQ",
  "KeyE",
  "KeyR",
  "KeyT",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Equal",
  "Minus",
  "NumpadAdd",
  "NumpadSubtract",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
]);

const DEMO_KEYBOARD_TOOL_PATHS = Object.freeze({
  MOVE: "tools/move",
  RANDOM_CIRCLE: "tools/create-circle",
  DEBUG: "tools/debug",
  VIEWPORT: "tools/viewport",
});

const DEMO_VIEWPORT_POSITION_STEP = 200;
const DEMO_VIEWPORT_SCALE_FACTOR = 0.5;
const WASD_ROUTE_PRESETS = Object.freeze({
  KeyW: Object.freeze({ x: 0, y: -1 }),
  KeyA: Object.freeze({ x: -1, y: 0 }),
  KeyS: Object.freeze({ x: 0, y: 1 }),
  KeyD: Object.freeze({ x: 1, y: 0 }),
});

function buildKeyboardTriggerForwardNodeConfig(relativeToolPath) {
  return {
    rewritePacket(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );

      if (triggerSignals.length === 0) {
        return [];
      }

      return {
        to: relativeToolPath,
        signals: triggerSignals,
      };
    },
  };
}

function buildViewportPositionNodeConfig(monitor, delta) {
  return {
    rewritePacket(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );

      if (triggerSignals.length === 0) {
        return [];
      }

      return {
        to: `../../${DEMO_KEYBOARD_TOOL_PATHS.VIEWPORT}`,
        signals: triggerSignals.map((signal) => ({
          type: "position",
          context: {
            value: {
              x: monitor.origin.x + (delta?.x ?? 0),
              y: monitor.origin.y + (delta?.y ?? 0),
            },
            code: signal?.context?.code,
            key: signal?.context?.key,
            sourceType: signal.type,
          },
        })),
      };
    },
  };
}

function buildViewportScaleNodeConfig(monitor, scaleTransformer) {
  return {
    rewritePacket(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );

      if (triggerSignals.length === 0) {
        return [];
      }

      return {
        to: `../../${DEMO_KEYBOARD_TOOL_PATHS.VIEWPORT}`,
        signals: triggerSignals.map((signal) => ({
          type: "scale",
          context: {
            value: scaleTransformer(monitor.zoom),
            code: signal?.context?.code,
            key: signal?.context?.key,
            sourceType: signal.type,
          },
        })),
      };
    },
  };
}

function buildViewportFlushNodeConfig() {
  return {
    rewritePacket(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );

      if (triggerSignals.length === 0) {
        return [];
      }

      return {
        to: `../../${DEMO_KEYBOARD_TOOL_PATHS.VIEWPORT}`,
        signals: triggerSignals.map((signal) => ({
          type: "flush",
          context: {
            code: signal?.context?.code,
            key: signal?.context?.key,
            sourceType: signal.type,
          },
        })),
      };
    },
  };
}

function buildWasdNodeConfig(code, vector) {
  return {
    rewritePacket(packet) {
      const movementSignals = packet.signals
        .filter(
          (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
        )
        .map((signal) => ({
          type: "position",
          context: {
            value: { ...vector },
            code,
            key: signal?.context?.key,
            sourceType: signal.type,
          },
        }));

      if (movementSignals.length === 0) {
        return [];
      }

      return {
        to: `../../${DEMO_KEYBOARD_TOOL_PATHS.MOVE}`,
        signals: movementSignals,
      };
    },
  };
}

function buildKeyboardDebugNodeConfig(type, context = {}) {
  return {
    rewritePacket(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );

      if (triggerSignals.length === 0) {
        return [];
      }

      return {
        to: `../../${DEMO_KEYBOARD_TOOL_PATHS.DEBUG}`,
        signals: [
          {
            type,
            context: { ...context },
          },
        ],
      };
    },
  };
}

function configureWhiteboardDemo(board, monitor, options = {}) {
  const effectiveBoard = board ?? monitor?.board;
  if (!effectiveBoard || !monitor) {
    throw new TypeError("configureWhiteboardDemo requires board and monitor");
  }

  const primaryStrokeTool =
    options.primaryStrokeTool ??
    new StrokeCreatorTool({
      property: { color: DEMO_PRIMARY_STROKE_COLOR, width: 2 },
    });
  const secondaryStrokeTool =
    options.secondaryStrokeTool ??
    new StrokeCreatorTool({
      property: { color: DEMO_SECONDARY_STROKE_COLOR, width: 2 },
    });
  const randomCircleTool =
    options.randomCircleTool ?? new RandomCircleCreatorTool();
  const wasdCoordinateTool =
    options.wasdCoordinateTool ?? new WasdCoordinateTool();
  const monitorViewportTool =
    options.monitorViewportTool ?? new MonitorViewportTool();
  const debugTool = options.debugTool ?? new DebuggerTool();
  const mouseDevice = options.mouseDevice ?? createMouseDevice();
  const keyboardDevice = options.keyboardDevice ?? createKeyboardDevice();
  const wasdRoutePresets = options.wasdRoutePresets ?? WASD_ROUTE_PRESETS;

  monitor.mountDevice("/mouse", mouseDevice);
  monitor.mountDevice("/keyboard", keyboardDevice);

  effectiveBoard.signalsEventBus.emit("mount", {
    to: `/${monitor.monitorId}/mouse/primary`,
    tool: primaryStrokeTool,
  });
  effectiveBoard.signalsEventBus.emit("mount", {
    to: `/${monitor.monitorId}/mouse/secondary`,
    tool: secondaryStrokeTool,
  });
  effectiveBoard.signalsEventBus.emit("mount", {
    to: `/${monitor.monitorId}/keyboard/${DEMO_KEYBOARD_TOOL_PATHS.RANDOM_CIRCLE}`,
    tool: randomCircleTool,
  });
  effectiveBoard.signalsEventBus.emit("mount", {
    to: `/${monitor.monitorId}/keyboard/${DEMO_KEYBOARD_TOOL_PATHS.MOVE}`,
    tool: wasdCoordinateTool,
  });
  effectiveBoard.signalsEventBus.emit("mount", {
    to: `/${monitor.monitorId}/keyboard/${DEMO_KEYBOARD_TOOL_PATHS.VIEWPORT}`,
    tool: monitorViewportTool,
  });
  effectiveBoard.signalsEventBus.emit("mount", {
    to: `/${monitor.monitorId}/keyboard/${DEMO_KEYBOARD_TOOL_PATHS.DEBUG}`,
    tool: debugTool,
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/Space`,
    options: buildKeyboardTriggerForwardNodeConfig(
      `../../${DEMO_KEYBOARD_TOOL_PATHS.RANDOM_CIRCLE}`,
    ),
  });

  for (const [code, vector] of Object.entries(wasdRoutePresets)) {
    effectiveBoard.signalsEventBus.emit("configure", {
      to: `/${monitor.monitorId}/keyboard/code/${code}`,
      options: buildWasdNodeConfig(code, vector),
    });
  }

  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/ArrowUp`,
    options: buildViewportPositionNodeConfig(
      monitor,
      new Vector(0, -1).scale(DEMO_VIEWPORT_POSITION_STEP).serialize(),
    ),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/ArrowDown`,
    options: buildViewportPositionNodeConfig(
      monitor,
      new Vector(0, 1).scale(DEMO_VIEWPORT_POSITION_STEP).serialize(),
    ),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/ArrowLeft`,
    options: buildViewportPositionNodeConfig(
      monitor,
      new Vector(-1, 0).scale(DEMO_VIEWPORT_POSITION_STEP).serialize(),
    ),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/ArrowRight`,
    options: buildViewportPositionNodeConfig(
      monitor,
      new Vector(1, 0).scale(DEMO_VIEWPORT_POSITION_STEP).serialize(),
    ),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/Equal`,
    options: buildViewportScaleNodeConfig(
      monitor,
      (zoom) => zoom / DEMO_VIEWPORT_SCALE_FACTOR,
    ),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/NumpadAdd`,
    options: buildViewportScaleNodeConfig(
      monitor,
      (zoom) => zoom / DEMO_VIEWPORT_SCALE_FACTOR,
    ),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/Minus`,
    options: buildViewportScaleNodeConfig(
      monitor,
      (zoom) => zoom * DEMO_VIEWPORT_SCALE_FACTOR,
    ),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/NumpadSubtract`,
    options: buildViewportScaleNodeConfig(
      monitor,
      (zoom) => zoom * DEMO_VIEWPORT_SCALE_FACTOR,
    ),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/KeyR`,
    options: buildViewportFlushNodeConfig(),
  });

  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/KeyC`,
    options: buildKeyboardDebugNodeConfig("debug:chunkload"),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/KeyO`,
    options: buildKeyboardDebugNodeConfig("debug:objectload"),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/KeyM`,
    options: buildKeyboardDebugNodeConfig("debug:aom"),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/KeyB`,
    options: buildKeyboardDebugNodeConfig("debug:board"),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/Digit1`,
    options: buildKeyboardDebugNodeConfig("debug:chunk", { id: 1 }),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/Digit2`,
    options: buildKeyboardDebugNodeConfig("debug:chunk", { id: 2 }),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/Digit3`,
    options: buildKeyboardDebugNodeConfig("debug:chunk", { id: 3 }),
  });
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/Digit4`,
    options: buildKeyboardDebugNodeConfig("debug:chunk", { id: 4 }),
  });

  console.log(`[whiteboard-demo] viewport keys: arrows=pan, +/-=zoom, R=flush`);
  console.log(
    `[whiteboard-demo] debug keys: C=chunkload, O=objectload, M=aom, B=board, 1/2/3/4=chunk detail`,
  );

  return {
    keyboardDevice,
    mouseDevice,
    monitorViewportTool,
    primaryStrokeTool,
    secondaryStrokeTool,
    randomCircleTool,
    wasdCoordinateTool,
    debugTool,
  };
}

export {
  buildKeyboardTriggerForwardNodeConfig,
  buildWasdNodeConfig,
  buildViewportFlushNodeConfig,
  buildViewportPositionNodeConfig,
  buildViewportScaleNodeConfig,
  configureWhiteboardDemo,
  DEMO_KEYBOARD_INPUT_CODES,
  DEMO_KEYBOARD_TOOL_PATHS,
  DEMO_PRIMARY_STROKE_COLOR,
  DEMO_SECONDARY_STROKE_COLOR,
  DEMO_VIEWPORT_POSITION_STEP,
  DEMO_VIEWPORT_SCALE_FACTOR,
  WASD_ROUTE_PRESETS,
};
