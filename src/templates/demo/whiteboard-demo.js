/**
 * @file whiteboard demo 配置
 * @module templates/demo/whiteboard-demo
 * @author Zhou Chenyu
 */

import { Logger } from "../../utils/log/logger.js";
import { logBus } from "../../utils/log/log-bus.js";
import { createMouseDevice } from "../../core/devices/mouse-device.js";
import {
  KEYBOARD_DEVICE_SIGNAL_TYPES,
  createKeyboardDevice,
} from "../../core/devices/keyboard-device.js";
import {
  createEdgePrefix,
  createHandoffSubDAG,
} from "../../core/prefixs/index.js";
import { StrokeCreatorTool } from "../../core/tools/creator/stroke-creator.js";
import { RectangleObjectChooserTool } from "../../core/tools/chooser/rectangle-object-chooser.js";
import { CommonObjectModifierTool } from "../../core/tools/modifier/common-object-modifier.js";
import { DebuggerTool } from "./debugger-tool.js";
import { createRandomCircleSubDAG } from "./random-circle-creator-tool.js";
import { MonitorViewportTool } from "./monitor-viewport-tool.js";

const DEMO_PRIMARY_STROKE_COLOR = "#ff0000";

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
  "Enter",
  "Escape",
]);

const DEMO_WORKFLOW_NAMES = Object.freeze({
  PRIMARY_STROKE: "primary-stroke",
  SECONDARY_CHOOSER: "secondary-chooser",
  RANDOM_CIRCLE: "create-circle",
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
    handler(packet, ctx = {}) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();
      return ctx.routeToChild(ctx.defaultRoute || "", triggerSignals);
    },
  };
}

/**
 * 构建视口位置移动 prefix handler
 * @description
 * 将 trigger 信号转为 position 信号，目标位置 = monitor.origin + (baseStep / zoom) * direction。
 * monitor 从 handlerContext.context 获取；路由依赖 defaultRoute。
 * @param {{ x: number, y: number }} direction - 位移方向（单位向量）
 * @param {number} [baseStep=200] - 缩放为 1 时的位移步长
 * @returns {{ handler: import("../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildViewportPositionNodeConfig(direction, baseStep = 200) {
  return {
    handler(packet, ctx = {}) {
      const monitor = ctx?.acc?.monitor;
      const zoom = monitor?.zoom ?? 1;
      const step = baseStep / zoom;
      const delta = {
        x: (direction?.x ?? 0) * step,
        y: (direction?.y ?? 0) * step,
      };
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();

      return ctx.routeToChild(ctx.defaultRoute || "", [
        ...triggerSignals.map((signal) =>
          ctx.signal(
            "position",
            {
              x: (monitor?.origin?.x ?? 0) + (delta?.x ?? 0),
              y: (monitor?.origin?.y ?? 0) + (delta?.y ?? 0),
            },
            {
              code: signal?.context?.code,
              key: signal?.context?.key,
              sourceType: signal.type,
            },
          ),
        ),
      ]);
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
    handler(packet, ctx = {}) {
      const monitor = ctx?.acc?.monitor;
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();

      return ctx.routeToChild(ctx.defaultRoute || "", [
        ...triggerSignals.map((signal) =>
          ctx.signal("scale", scaleTransformer(monitor?.zoom ?? 1), {
            code: signal?.context?.code,
            key: signal?.context?.key,
            sourceType: signal.type,
          }),
        ),
      ]);
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
    handler(packet, ctx = {}) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();
      return ctx.routeToChild(ctx.defaultRoute || "", [
        ...triggerSignals.map((signal) =>
          ctx.signal("flush", undefined, {
            code: signal?.context?.code,
            key: signal?.context?.key,
            sourceType: signal.type,
          }),
        ),
      ]);
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
    handler(packet, ctx = {}) {
      const movementSignals = packet.signals
        .filter(
          (signal) =>
            signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER ||
            signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER_REPEAT,
        )
        .map((signal) =>
          ctx.signal(
            "displacement",
            { ...vector },
            {
              code,
              key: signal?.context?.key,
              sourceType: signal.type,
            },
          ),
        );

      if (movementSignals.length === 0) return ctx.stop();
      return ctx.routeToChild(ctx.defaultRoute || "", movementSignals);
    },
  };
}

/**
 * 构建键盘调试 prefix handler
 * @description 将 trigger 信号转为指定调试类型的信号。type 可以是静态字符串或
 * 动态函数 (signals) => string（如根据 Shift 分流）。
 * @param {string | ((signals: object[]) => string)} type - 调试信号类型或解析函数
 * @param {Object} [debugContext={}] - 调试上下文附加数据
 * @returns {{ handler: import("../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildKeyboardDebugNodeConfig(type, debugContext = {}) {
  return {
    handler(packet, ctx = {}) {
      const triggerSignals = packet.signals.filter(
        (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();
      const resolvedType =
        typeof type === "function" ? type(triggerSignals) : type;
      return ctx.routeToChild(ctx.defaultRoute || "", [
        ctx.signal(resolvedType, undefined, debugContext),
      ]);
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
 * @param {import("../../core/components/index.js").Board} board - 白板实例
 * @param {import("../../core/components/index.js").Monitor|import("../../core/components/index.js").MonitorProxy} monitor - 显示器实例
 * @param {Object} [options={}] - 可选覆盖配置
 * @param {import("../../core/tools/creator/stroke-creator.js").StrokeCreatorTool} [options.primaryStrokeTool]
 * @param {import("../../core/tools/chooser/rectangle-object-chooser.js").RectangleObjectChooserTool} [options.secondarySelectionTool]
 * @param {Object} [options.randomCircleSubDAG]
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
 *   debugTool: DebuggerTool,
 * }}
 */
function configureWhiteboardDemo(board, monitor, options = {}) {
  const demoLog = new Logger("DemoConfig", "INFO", logBus);

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
  const monitorViewportTool =
    options.monitorViewportTool ?? new MonitorViewportTool();
  const debugTool = options.debugTool ?? new DebuggerTool();
  const mouseDevice = options.mouseDevice ?? createMouseDevice();
  const wasdRoutePresets = options.wasdRoutePresets ?? WASD_ROUTE_PRESETS;
  const keyboardDevice = options.keyboardDevice ?? createKeyboardDevice();

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
  const secondaryHandoffSubDAG = createHandoffSubDAG({
    rootPath: `/workflows/${DEMO_WORKFLOW_NAMES.SECONDARY_CHOOSER}`,
    first: secondarySelectionTool,
    second: new CommonObjectModifierTool(),
    autoBridgeObjects: true,
  });

  // Enter → success, Escape → cancel，路由到 handoff modifier
  const signalForwardNodeConfig = (targetType) => ({
    handler(packet, ctx = {}) {
      const triggerSignals = packet.signals.filter(
        (s) => s.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();
      return ctx.routeToChild(ctx.defaultRoute || "", [
        ctx.signal(targetType, undefined, {}),
      ]);
    },
  });

  effectiveBoard.signalsEventBus.emit("mount", {
    monitorId: monitor.monitorId,
    name: DEMO_WORKFLOW_NAMES.SECONDARY_CHOOSER,
    workflow: secondaryHandoffSubDAG,
    edges: [
      { from: "/mouse/secondary", edge: "default" },
      {
        from: "/keyboard/code/Enter",
        edge: "default",
        prefix: createEdgePrefix(signalForwardNodeConfig("success")),
      },
      {
        from: "/keyboard/code/Escape",
        edge: "default",
        prefix: createEdgePrefix(signalForwardNodeConfig("cancel")),
      },
      // WASD → displacement 到 handoff modifier
      ...Object.entries(wasdRoutePresets).map(([code, vector]) => ({
        from: `/keyboard/code/${code}`,
        edge: "default",
        prefix: createEdgePrefix(buildWasdNodeConfig(code, vector)),
      })),
    ],
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

  // Viewport：position / scale / flush 三类 prefix
  {
    const step = DEMO_VIEWPORT_POSITION_STEP;
    const factor = DEMO_VIEWPORT_SCALE_FACTOR;

    const positionEdges = [
      { code: "ArrowUp", direction: { x: 0, y: -1 } },
      { code: "ArrowDown", direction: { x: 0, y: 1 } },
      { code: "ArrowLeft", direction: { x: -1, y: 0 } },
      { code: "ArrowRight", direction: { x: 1, y: 0 } },
    ].map(({ code, direction }) => ({
      from: `/keyboard/code/${code}`,
      edge: "default",
      prefix: createEdgePrefix(
        buildViewportPositionNodeConfig(direction, step),
      ),
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
      {
        code: "KeyT",
        type: (signals) =>
          signals.some((s) => s?.context?.shiftKey)
            ? "debug:mermaid"
            : "debug:devices",
      },
      { code: "Digit1", type: "debug:chunk", ctx: { id: 1 } },
      { code: "Digit2", type: "debug:chunk", ctx: { id: 2 } },
      { code: "Digit3", type: "debug:chunk", ctx: { id: 3 } },
      { code: "Digit4", type: "debug:chunk", ctx: { id: 4 } },
    ].map(({ code, type, ctx }) => ({
      from: `/keyboard/code/${code}`,
      edge: "default",
      prefix: createEdgePrefix(buildKeyboardDebugNodeConfig(type, ctx)),
    }));

    effectiveBoard.signalsEventBus.emit("mount", {
      monitorId: monitor.monitorId,
      name: DEMO_WORKFLOW_NAMES.DEBUG,
      workflow: debugTool,
      edges: simpleDebugEdges,
    });
  }

  demoLog.info(
    `── 快捷键 ──\n` +
      `左键 : 创建笔画\n` +
      `右键 : 首次拖拽框选对象 → 再次拖拽修改位置\n` +
      `Enter : 提交修改\n` +
      `Escape : 取消修改\n` +
      `Space : 随机圆\n` +
      `W/A/S/D : 移动选中对象（二次拖拽激活后）\n` +
      `方向键 : 平移视口\n` +
      `+/- : 缩放视口\n` +
      `R : 刷新视口\n` +
      `C/O : 区块/对象加载调试\n` +
      `M : AOM 调试\n` +
      `B : 白板调试\n` +
      `T : 设备图调试（Shift+T = mermaid）\n` +
      `1-4 : 区块详情`,
  );

  return {
    keyboardDevice,
    mouseDevice,
    monitorViewportTool,
    primaryStrokeTool,
    secondarySelectionTool,
    debugTool,
  };
}

export {
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
