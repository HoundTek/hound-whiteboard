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
import { RectangleObjectChooserTool } from "../../core/tools/chooser/rectangle-object-chooser.js";
import { DebuggerTool } from "./debugger-tool.js";
import { createRandomCircleSubTree } from "./random-circle-creator-tool.js";
import { WasdCoordinateTool } from "./wasd-coordinate-tool.js";
import { MonitorViewportTool } from "./monitor-viewport-tool.js";
import { Vector } from "../../core/utils/math.js";

const DEMO_PRIMARY_STROKE_COLOR = "#000000";
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

const DEMO_KEYBOARD_TOOL_PATHS = Object.freeze({
  MOVE: "tool",
  RANDOM_CIRCLE: "create-circle",
  RANDOM_CIRCLE_TOOL: "create-circle/tool",
  DEBUG: "tool",
  VIEWPORT: "tool",
});

const DEMO_VIEWPORT_CODES = Object.freeze([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Equal",
  "Minus",
  "NumpadAdd",
  "NumpadSubtract",
  "KeyR",
]);

const DEMO_DEBUG_CODES = Object.freeze([
  "KeyC",
  "KeyO",
  "KeyM",
  "KeyB",
  "KeyT",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
]);

const DEMO_VIEWPORT_POSITION_STEP = 200;
const DEMO_VIEWPORT_SCALE_FACTOR = 0.5;
const WASD_ROUTE_PRESETS = Object.freeze({
  KeyW: Object.freeze({ x: 0, y: -1 }),
  KeyA: Object.freeze({ x: -1, y: 0 }),
  KeyS: Object.freeze({ x: 0, y: 1 }),
  KeyD: Object.freeze({ x: 1, y: 0 }),
});

/**
 * 将键位编码转为安全的 URI 路径片段
 * @param {any} code - 原始键位编码
 * @returns {string} URI 编码后的键位字符串
 */
function encodeKeyboardCode(code) {
  return encodeURIComponent(String(code));
}

/**
 * 获取键盘键位的设备图路径
 * @param {any} code - 键位编码
 * @param {string} [childPath=""] - 子路径后缀
 * @returns {string} 完整设备图路径
 */
function getKeyboardCodePath(code, childPath = "") {
  const basePath = `/keyboard/code/${encodeKeyboardCode(code)}`;
  return childPath ? `${basePath}/${childPath}` : basePath;
}

/**
 * 获取 Monitor 限定下的键盘键位设备图路径
 * @param {string|number} monitorId - 显示器 id
 * @param {any} code - 键位编码
 * @param {string} [childPath=""] - 子路径后缀
 * @returns {string} 带 Monitor 前缀的完整设备图路径
 */
function getMonitorKeyboardCodePath(monitorId, code, childPath = "") {
  return `/${monitorId}${getKeyboardCodePath(code, childPath)}`;
}

/**
 * 为指定键位列表创建空配置映射
 * @param {string[]} [codes=[]] - 键位编码列表
 * @returns {Record<string, {}>} 路径 -> 空配置的映射
 */
function createKeyboardNodeConfigs(codes = []) {
  return Object.fromEntries(
    [...new Set(codes)].map((code) => [`/code/${code}`, {}]),
  );
}

/**
 * 构建键盘触发信号转发节点配置
 * @description 过滤出 trigger 信号并转发到指定工具路径，用于没有业务处理的简单键位路由。
 * @param {string} relativeToolPath - 相对工具路径（如 "tool" 或 "create-circle/tool"）
 * @returns {{ handler: import("../../core/devices/devices-dag.js").DevicesDAGHandler }} 节点配置对象
 */
function buildKeyboardTriggerForwardNodeConfig(relativeToolPath) {
  return {
    handler(packet) {
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

/**
 * 构建视口位置移动节点配置
 * @description 将 trigger 信号转为 position 信号，目标位置 = monitor.origin + delta。
 * @param {import("../../core/components/monitor.js").Monitor} monitor - 显示器实例
 * @param {{ x: number, y: number }} delta - 位移增量
 * @returns {{ handler: import("../../core/devices/devices-dag.js").DevicesDAGHandler }} 节点配置对象
 */
function buildViewportPositionNodeConfig(monitor, delta) {
  return {
    handler(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );

      if (triggerSignals.length === 0) {
        return [];
      }

      return {
        to: DEMO_KEYBOARD_TOOL_PATHS.VIEWPORT,
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

/**
 * 构建视口缩放节点配置
 * @description 将 trigger 信号转为 scale 信号，缩放值由 scaleTransformer 函数计算。
 * @param {import("../../core/components/monitor.js").Monitor} monitor - 显示器实例
 * @param {(currentZoom: number) => number} scaleTransformer - 缩放变换函数
 * @returns {{ handler: import("../../core/devices/devices-dag.js").DevicesDAGHandler }} 节点配置对象
 */
function buildViewportScaleNodeConfig(monitor, scaleTransformer) {
  return {
    handler(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );

      if (triggerSignals.length === 0) {
        return [];
      }

      return {
        to: DEMO_KEYBOARD_TOOL_PATHS.VIEWPORT,
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

/**
 * 构建视口刷新节点配置
 * @description 将 trigger 信号转为 flush 信号，触发 MonitorViewportTool 执行刷新。
 * @returns {{ handler: import("../../core/devices/devices-dag.js").DevicesDAGHandler }} 节点配置对象
 */
function buildViewportFlushNodeConfig() {
  return {
    handler(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );

      if (triggerSignals.length === 0) {
        return [];
      }

      return {
        to: DEMO_KEYBOARD_TOOL_PATHS.VIEWPORT,
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
 * 构建 WASD 方向键移动节点配置
 * @description 将 trigger 信号转为 position 信号，附上对应方向向量，路由到共享 WASD 工具节点。
 * @param {string} code - 键位编码（如 "KeyW"）
 * @param {{ x: number, y: number }} vector - 方向向量
 * @returns {{ handler: import("../../core/devices/devices-dag.js").DevicesDAGHandler }} 节点配置对象
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

      if (movementSignals.length === 0) {
        return [];
      }

      return {
        to: "wasd",
        signals: movementSignals,
      };
    },
  };
}

/**
 * 构建键盘调试节点配置
 * @description 将 trigger 信号转为指定调试类型的信号，路由到共享 Debugger 工具节点。
 * @param {string} type - 调试信号类型（如 "debug:chunkload"）
 * @param {Object} [context={}] - 调试上下文附加数据
 * @returns {{ handler: import("../../core/devices/devices-dag.js").DevicesDAGHandler }} 节点配置对象
 */
function buildKeyboardDebugNodeConfig(type, context = {}) {
  return {
    handler(packet) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );

      if (triggerSignals.length === 0) {
        return [];
      }

      return {
        to: "debug",
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

/**
 * 配置白板 Demo 的完整设备图与工具绑定
 * @description
 * 为指定 board 和 monitor 挂载鼠标/键盘设备子图，注册鼠标主/副工具、
 * WASD 坐标工具、视口控制工具、调试工具，以及所有键盘快捷键的信号路由。
 *
 * 工具挂载原则：
 * - 每个 Tool 实例只挂载到一个 DAG 节点（单实例单节点）
 * - 多键位汇聚使用 addEdge 多前驱模式
 *
 * @param {import("../../core/components/board.js").Board} board - 白板实例
 * @param {import("../../core/components/monitor.js").Monitor} monitor - 显示器实例
 * @param {Object} [options={}] - 可选覆盖配置
 * @param {import("../../core/tools/creator/stroke-creator.js").StrokeCreatorTool} [options.primaryStrokeTool]
 * @param {import("../../core/tools/chooser/rectangle-object-chooser.js").RectangleObjectChooserTool} [options.secondarySelectionTool]
 * @param {Object} [options.randomCircleSubTree]
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
  const randomCircleSubTree =
    options.randomCircleSubTree ??
    options.randomCircleDevice ??
    createRandomCircleSubTree({
      rootPath: getKeyboardCodePath(
        "Space",
        DEMO_KEYBOARD_TOOL_PATHS.RANDOM_CIRCLE,
      ),
    });
  const wasdCoordinateTool =
    options.wasdCoordinateTool ?? new WasdCoordinateTool();
  const monitorViewportTool =
    options.monitorViewportTool ?? new MonitorViewportTool();
  const debugTool = options.debugTool ?? new DebuggerTool();
  const mouseDevice = options.mouseDevice ?? createMouseDevice();
  const wasdRoutePresets = options.wasdRoutePresets ?? WASD_ROUTE_PRESETS;
  const keyboardDevice =
    options.keyboardDevice ??
    createKeyboardDevice({
      nodeConfigs: createKeyboardNodeConfigs([
        ...DEMO_KEYBOARD_INPUT_CODES,
        ...Object.keys(wasdRoutePresets),
        ...DEMO_VIEWPORT_CODES,
        ...DEMO_DEBUG_CODES,
      ]),
    });

  monitor.mountSubDAG("/mouse", mouseDevice);
  monitor.mountSubDAG("/keyboard", keyboardDevice);

  effectiveBoard.signalsEventBus.emit("mount", {
    to: `/${monitor.monitorId}/mouse/primary/tool`,
    tool: primaryStrokeTool,
  });
  effectiveBoard.signalsEventBus.emit("mount", {
    to: `/${monitor.monitorId}/mouse/secondary/tool`,
    tool: secondarySelectionTool,
  });
  if (randomCircleSubTree) {
    monitor.mountSubDAG("", randomCircleSubTree);
  }
  for (const code of Object.keys(wasdRoutePresets)) {
    monitor.addEdge(`/keyboard/code/${code}`, "wasd", "/keyboard/wasd-move");
  }
  // 挂载共享 WASD 工具节点（一次），四个键通过 addEdge 聚合到同一个节点
  monitor.mountTool("/keyboard/wasd-move", wasdCoordinateTool);
  for (const code of DEMO_VIEWPORT_CODES) {
    effectiveBoard.signalsEventBus.emit("mount", {
      to: getMonitorKeyboardCodePath(
        monitor.monitorId,
        code,
        DEMO_KEYBOARD_TOOL_PATHS.VIEWPORT,
      ),
      tool: monitorViewportTool,
    });
  }

  for (const code of DEMO_DEBUG_CODES) {
    monitor.addEdge(`/keyboard/code/${code}`, "debug", "/keyboard/debug");
  }

  // 挂载共享 Debugger 工具节点（一次），多个调试键通过 addEdge 聚合到同一个节点
  monitor.mountTool("/keyboard/debug", debugTool);
  effectiveBoard.signalsEventBus.emit("configure", {
    to: `/${monitor.monitorId}/keyboard/code/Space`,
    options: buildKeyboardTriggerForwardNodeConfig(
      DEMO_KEYBOARD_TOOL_PATHS.RANDOM_CIRCLE,
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
    to: `/${monitor.monitorId}/keyboard/code/KeyT`,
    options: buildKeyboardDebugNodeConfig("debug:devices"),
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
    `[whiteboard-demo] debug keys: C=chunkload, O=objectload, M=aom, B=board, T=devices, 1/2/3/4=chunk detail`,
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
  buildKeyboardTriggerForwardNodeConfig,
  buildWasdNodeConfig,
  buildViewportFlushNodeConfig,
  buildViewportPositionNodeConfig,
  buildViewportScaleNodeConfig,
  configureWhiteboardDemo,
  DEMO_KEYBOARD_INPUT_CODES,
  DEMO_KEYBOARD_TOOL_PATHS,
  DEMO_PRIMARY_STROKE_COLOR,
  DEMO_VIEWPORT_POSITION_STEP,
  DEMO_VIEWPORT_SCALE_FACTOR,
  WASD_ROUTE_PRESETS,
};
