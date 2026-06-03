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
import { createEdgePrefix } from "../../core/prefixs/index.js";
import { StrokeCreatorTool } from "../../core/tools/creator/stroke-creator.js";
import { RectangleObjectChooserTool } from "../../core/tools/chooser/rectangle-object-chooser.js";
import { DebuggerTool } from "./debugger-tool.js";
import { createRandomCircleSubDAG } from "./random-circle-creator-tool.js";
import { WasdCoordinateTool } from "./wasd-coordinate-tool.js";
import { MonitorViewportTool } from "./monitor-viewport-tool.js";

const DEMO_PRIMARY_STROKE_COLOR = "#000000";

/** @type {ReadonlyArray<string>} 所有活跃按键编码 */
const DEMO_KEYBOARD_INPUT_CODES = Object.freeze([
  "Space",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyR",
  "KeyC",
  "KeyO",
  "KeyM",
  "KeyB",
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

const DEMO_WORKFLOW_NAMES = Object.freeze({
  PRIMARY_STROKE: "primary-stroke",
  SECONDARY_CHOOSER: "secondary-chooser",
  RANDOM_CIRCLE: "create-circle",
  WASD_MOVE: "wasd-move",
  DEBUG: "debug",
  VIEWPORT: "viewport",
});

const DEMO_VIEWPORT_POSITION_STEP = 200;
const DEMO_VIEWPORT_SCALE_FACTOR = 0.5;
const WASD_ROUTE_PRESETS = Object.freeze({
  KeyW: Object.freeze({ x: 0, y: -1 }),
  KeyA: Object.freeze({ x: -1, y: 0 }),
  KeyS: Object.freeze({ x: 0, y: 1 }),
  KeyD: Object.freeze({ x: 1, y: 0 }),
});

/**
 * 构建键盘触发信号转发 prefix handler
 * @description
 * 过滤出 trigger 信号并返回，路由依赖 defaultRoute 自动走边。
 * @returns {{ handler: import("../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildKeyboardTriggerForwardNodeConfig() {
  return {
    handler(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return [];
      return { signals: triggerSignals };
    },
  };
}

/**
 * 构建视口位置移动 prefix handler
 * @description
 * 将 trigger 信号转为 position 信号，目标位置 = monitor.origin + delta。
 * monitor 从 handlerContext.context 获取；路由依赖 defaultRoute。
 * @param {{ x: number, y: number }} delta - 位移增量
 * @returns {{ handler: import("../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildViewportPositionNodeConfig(delta) {
  return {
    handler(packet, context) {
      const monitor = context?.context?.monitor;
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return [];

      return {
        signals: triggerSignals.map((signal) => ({
          type: "position",
          context: {
            value: {
              x: (monitor?.origin?.x ?? 0) + (delta?.x ?? 0),
              y: (monitor?.origin?.y ?? 0) + (delta?.y ?? 0),
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

/**
 * 构建视口缩放 prefix handler
 * @description
 * 将 trigger 信号转为 scale 信号，缩放值由 scaleTransformer 函数计算。
 * monitor 从 handlerContext.context 获取；路由依赖 defaultRoute。
 * @param {(currentZoom: number) => number} scaleTransformer - 缩放变换函数
 * @returns {{ handler: import("../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildViewportScaleNodeConfig(scaleTransformer) {
  return {
    handler(packet, context) {
      const monitor = context?.context?.monitor;
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return [];

      return {
        signals: triggerSignals.map((signal) => ({
          type: "scale",
          context: {
            value: scaleTransformer(monitor?.zoom ?? 1),
            code: signal?.context?.code,
            key: signal?.context?.key,
            sourceType: signal.type,
          },
        })),
      };
    },
  };
}

/**
 * 构建视口刷新 prefix handler
 * @description 将 trigger 信号转为 flush 信号，路由依赖 defaultRoute。
 * @returns {{ handler: import("../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildViewportFlushNodeConfig() {
  return {
    handler(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return [];
      return {
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

/**
 * 构建 WASD 方向键移动 prefix handler
 * @description 将 trigger 信号转为 position 信号，附上对应方向向量。
 * @param {string} code - 键位编码（如 "KeyW"）
 * @param {{ x: number, y: number }} vector - 方向向量
 * @returns {{ handler: import("../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildWasdNodeConfig(code, vector) {
  return {
    handler(packet) {
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

      if (movementSignals.length === 0) return [];
      return { signals: movementSignals };
    },
  };
}

/**
 * 构建键盘调试 prefix handler
 * @description 将 trigger 信号转为指定调试类型的信号。
 * @param {string} type - 调试信号类型（如 "debug:chunkload"）
 * @param {Object} [context={}] - 调试上下文附加数据
 * @returns {{ handler: import("../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildKeyboardDebugNodeConfig(type, context = {}) {
  return {
    handler(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return [];
      return { signals: [{ type, context: { ...context } }] };
    },
  };
}

/**
 * 构建 KeyT 双模调试 prefix handler
 * @description Shift+T → "debug:mermaid"，普通 T → "debug:devices"。
 * @returns {{ handler: import("../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildKeyboardDebugKeyTHandler() {
  return {
    handler(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return [];
      const isShift = triggerSignals.some((s) => s?.context?.shiftKey);
      return {
        signals: [{ type: isShift ? "debug:mermaid" : "debug:devices" }],
      };
    },
  };
}

/**
 * 配置白板 Demo 的完整设备图与 workflow 绑定
 * @description
 * 为指定 board 和 monitor 挂载鼠标/键盘设备子图，注册 stroke、selector、
 * WASD、viewport、debug、random-circle 等 workflow。
 *
 * 所有设备叶节点的 defaultRoute 统一为 "default"；
 * 所有键位级信号转换通过边级 prefix（createEdgePrefix）注入；
 * prefix handler 不再指定 to:，依赖 defaultRoute 自动走边。
 *
 * @param {import("../../core/components/board.js").Board} board - 白板实例
 * @param {import("../../core/components/monitor.js").Monitor} monitor - 显示器实例
 * @param {Object} [options={}] - 可选覆盖配置
 * @param {import("../../core/tools/creator/stroke-creator.js").StrokeCreatorTool} [options.primaryStrokeTool]
 * @param {import("../../core/tools/chooser/rectangle-object-chooser.js").RectangleObjectChooserTool} [options.secondarySelectionTool]
 * @param {Object} [options.randomCircleSubDAG]
 * @param {WasdCoordinateTool} [options.wasdCoordinateTool]
 * @param {MonitorViewportTool} [options.monitorViewportTool]
 * @param {DebuggerTool} [options.debugTool]
 * @param {import("../../core/devices/mouse-device.js").MouseSubDAGDefinition} [options.mouseDevice]
 * @param {Record<string, { x: number, y: number }>} [options.wasdRoutePresets]
 * @param {import("../../core/devices/keyboard-device.js").KeyboardSubDAGDefinition} [options.keyboardDevice]
 * @returns {{
 *   keyboardDevice: import("../../core/devices/keyboard-device.js").KeyboardSubDAGDefinition,
 *   mouseDevice: import("../../core/devices/mouse-device.js").MouseSubDAGDefinition,
 *   monitorViewportTool: MonitorViewportTool,
 *   primaryStrokeTool: import("../../core/tools/creator/stroke-creator.js").StrokeCreatorTool,
 *   secondarySelectionTool: import("../../core/tools/chooser/rectangle-object-chooser.js").RectangleObjectChooserTool,
 *   wasdCoordinateTool: WasdCoordinateTool,
 *   debugTool: DebuggerTool,
 * }}
 */
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
  const secondarySelectionTool =
    options.secondarySelectionTool ?? new RectangleObjectChooserTool();
  const randomCircleSubDAG =
    options.randomCircleSubDAG ??
    options.randomCircleDevice ??
    createRandomCircleSubDAG({
      rootPath: `/workflows/${DEMO_WORKFLOW_NAMES.RANDOM_CIRCLE}`,
    });
  const wasdCoordinateTool =
    options.wasdCoordinateTool ?? new WasdCoordinateTool();
  const monitorViewportTool =
    options.monitorViewportTool ?? new MonitorViewportTool();
  const debugTool = options.debugTool ?? new DebuggerTool();
  const mouseDevice = options.mouseDevice ?? createMouseDevice();
  const wasdRoutePresets = options.wasdRoutePresets ?? WASD_ROUTE_PRESETS;
  const keyboardDevice =
    options.keyboardDevice ?? createKeyboardDevice();

  monitor.mountSubDAG("/mouse", mouseDevice);
  monitor.mountSubDAG("/keyboard", keyboardDevice);

  // 所有设备叶节点 defaultRoute = "default"，
  // 所有 mount edge 统一 "default"，handler 不再写 to:

  // 鼠标（无需 prefix，信号直接可被工具消费）
  effectiveBoard.signalsEventBus.emit("mount", {
    monitorId: monitor.monitorId,
    name: DEMO_WORKFLOW_NAMES.PRIMARY_STROKE,
    workflow: primaryStrokeTool,
    edges: [{ from: "/mouse/primary", edge: "default" }],
  });
  effectiveBoard.signalsEventBus.emit("mount", {
    monitorId: monitor.monitorId,
    name: DEMO_WORKFLOW_NAMES.SECONDARY_CHOOSER,
    workflow: secondarySelectionTool,
    edges: [{ from: "/mouse/secondary", edge: "default" }],
  });

  // Space → prefix → random-circle
  if (randomCircleSubDAG) {
    effectiveBoard.signalsEventBus.emit("mount", {
      monitorId: monitor.monitorId,
      name: DEMO_WORKFLOW_NAMES.RANDOM_CIRCLE,
      workflow: randomCircleSubDAG,
      edges: [
        {
          from: "/keyboard/code/Space",
          edge: "default",
          prefix: createEdgePrefix(buildKeyboardTriggerForwardNodeConfig()),
        },
      ],
    });
  }

  // WASD → per-key prefix
  effectiveBoard.signalsEventBus.emit("mount", {
    monitorId: monitor.monitorId,
    name: DEMO_WORKFLOW_NAMES.WASD_MOVE,
    workflow: wasdCoordinateTool,
    edges: Object.entries(wasdRoutePresets).map(([code, vector]) => ({
      from: `/keyboard/code/${code}`,
      edge: "default",
      prefix: createEdgePrefix(buildWasdNodeConfig(code, vector)),
    })),
  });

  // Viewport：position / scale / flush 三类 prefix
  {
    const step = DEMO_VIEWPORT_POSITION_STEP;
    const factor = DEMO_VIEWPORT_SCALE_FACTOR;

    const positionEdges = [
      { code: "ArrowUp", delta: { x: 0, y: -step } },
      { code: "ArrowDown", delta: { x: 0, y: step } },
      { code: "ArrowLeft", delta: { x: -step, y: 0 } },
      { code: "ArrowRight", delta: { x: step, y: 0 } },
    ].map(({ code, delta }) => ({
      from: `/keyboard/code/${code}`,
      edge: "default",
      prefix: createEdgePrefix(buildViewportPositionNodeConfig(delta)),
    }));

    const scaleEdges = [
      { code: "Equal", transformer: (zoom) => zoom / factor },
      { code: "NumpadAdd", transformer: (zoom) => zoom / factor },
      { code: "Minus", transformer: (zoom) => zoom * factor },
      { code: "NumpadSubtract", transformer: (zoom) => zoom * factor },
    ].map(({ code, transformer }) => ({
      from: `/keyboard/code/${code}`,
      edge: "default",
      prefix: createEdgePrefix(buildViewportScaleNodeConfig(transformer)),
    }));

    const flushEdge = {
      from: "/keyboard/code/KeyR",
      edge: "default",
      prefix: createEdgePrefix(buildViewportFlushNodeConfig()),
    };

    effectiveBoard.signalsEventBus.emit("mount", {
      monitorId: monitor.monitorId,
      name: DEMO_WORKFLOW_NAMES.VIEWPORT,
      workflow: monitorViewportTool,
      edges: [...positionEdges, ...scaleEdges, flushEdge],
    });
  }

  // Debug：C/O/M/B/T/1-4 → per-key prefix
  {
    const simpleDebugEdges = [
      { code: "KeyC", type: "debug:chunkload" },
      { code: "KeyO", type: "debug:objectload" },
      { code: "KeyM", type: "debug:aom" },
      { code: "KeyB", type: "debug:board" },
      { code: "Digit1", type: "debug:chunk", ctx: { id: 1 } },
      { code: "Digit2", type: "debug:chunk", ctx: { id: 2 } },
      { code: "Digit3", type: "debug:chunk", ctx: { id: 3 } },
      { code: "Digit4", type: "debug:chunk", ctx: { id: 4 } },
    ].map(({ code, type, ctx }) => ({
      from: `/keyboard/code/${code}`,
      edge: "default",
      prefix: createEdgePrefix(buildKeyboardDebugNodeConfig(type, ctx)),
    }));

    const keyTEdge = {
      from: "/keyboard/code/KeyT",
      edge: "default",
      prefix: createEdgePrefix(buildKeyboardDebugKeyTHandler()),
    };

    effectiveBoard.signalsEventBus.emit("mount", {
      monitorId: monitor.monitorId,
      name: DEMO_WORKFLOW_NAMES.DEBUG,
      workflow: debugTool,
      edges: [...simpleDebugEdges, keyTEdge],
    });
  }

  console.log(`[whiteboard-demo] viewport keys: arrows=pan, +/-=zoom, R=flush`);
  console.log(
    `[whiteboard-demo] debug keys: C=chunkload, O=objectload, M=aom, B=board, T=devices-dag, Shift+T=devices-mermaid, 1/2/3/4=chunk detail`,
  );

  return {
    keyboardDevice,
    mouseDevice,
    monitorViewportTool,
    primaryStrokeTool,
    secondarySelectionTool,
    wasdCoordinateTool,
    debugTool,
  };
}

export {
  buildKeyboardDebugKeyTHandler,
  buildKeyboardDebugNodeConfig,
  buildKeyboardTriggerForwardNodeConfig,
  buildWasdNodeConfig,
  buildViewportFlushNodeConfig,
  buildViewportPositionNodeConfig,
  buildViewportScaleNodeConfig,
  configureWhiteboardDemo,
  DEMO_KEYBOARD_INPUT_CODES,
  DEMO_PRIMARY_STROKE_COLOR,
  DEMO_VIEWPORT_POSITION_STEP,
  DEMO_VIEWPORT_SCALE_FACTOR,
  DEMO_WORKFLOW_NAMES,
  WASD_ROUTE_PRESETS,
};
