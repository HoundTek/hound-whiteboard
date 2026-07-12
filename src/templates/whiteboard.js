/**
 * @file whiteboard demo 浏览器入口
 * @description 初始化 whiteboard demo 页面，通过 Worker 与 BoardCore 通信。
 * @module templates/whiteboard
 * @author Zhou Chenyu
 */

import { Vector } from "../core/utils/math.js";
import { Board } from "../core/ui/components/orchestration/board.js";
import { Logger } from "../utils/log/logger.js";
import { logBus } from "../utils/log/log-bus.js";
import { createConsolePrinter } from "../utils/log/console-printer.js";
import {
  configureWhiteboardDemo,
  DEMO_KEYBOARD_INPUT_CODES,
  DEMO_WORKFLOW_NAMES,
} from "./demo/whiteboard-demo.js";
import { ViewportTool } from "./demo/viewport-tool.js";
import { createButtonGroupDevice } from "../core/ui/devices-dag/devices/button-group-device.js";
import { createToolSwitcherSubDAG } from "../core/ui/devices-dag/prefixes/tool-switcher.js";
import { createHandoffSubDAG } from "../core/ui/devices-dag/prefixes/index.js";
import { CircleCreatorTool } from "../core/ui/devices-dag/tools/creator/circle-creator.js";
import { RectangleObjectChooserTool } from "../core/ui/devices-dag/tools/chooser/rectangle-object-chooser.js";
import { CommonObjectModifierTool } from "../core/ui/devices-dag/tools/modifier/common-object-modifier.js";

// Demo 独立入口，需要手动注册控制台输出器
createConsolePrinter(logBus, { timestamps: true });

/**
 * 启动 whiteboard demo 页面
 * @returns {Promise<void>}
 */
async function bootstrapWhiteboard() {
  const board = new Board();
  board.width = 800;
  board.height = 600;

  const appLeft = document.getElementById("app-left");
  const foregroundLayer = document.getElementById("app-foreground-layer");
  if (!appLeft || !foregroundLayer) {
    throw new Error("whiteboard demo root elements not found.");
  }

  const worker = new Worker(
    new URL("../core/worker/core-worker.js", import.meta.url),
    {
      type: "module",
    },
  );

  try {
    await board.enableWorkerMode(worker);
  } catch (error) {
    worker.terminate?.();
    throw error;
  }

  const viewport = board.createViewport(
    foregroundLayer,
    {
      width: appLeft.clientWidth,
      height: window.innerHeight,
    },
    "viewport",
  );
  viewport.zoom = 1.0;
  viewport.origin = new Vector(0, 0);
  viewport.canvas.tabIndex = 0;

  const demoLog = new Logger("Demo", "INFO", logBus);

  /**
   * 输出 demo 状态日志
   * @param {string} label - 日志标签
   * @param {*} [payload] - 附加载荷
   * @returns {void}
   */
  const logDemoStatus = (label, payload) => {
    if (payload === undefined) {
      demoLog.info(label);
      return;
    }

    demoLog.info(label, payload);
  };

  const viewportTool = new ViewportTool({
    onViewportChange(targetViewport) {
      logDemoStatus("视口状态", {
        origin: targetViewport.origin.serialize(),
        zoom: targetViewport.zoom,
      });
    },
    onFlush(targetViewport) {
      logDemoStatus("视口全屏刷新", {
        origin: targetViewport.origin.serialize(),
        zoom: targetViewport.zoom,
      });
    },
  });

  logDemoStatus("运行模式", "Worker");
  logDemoStatus("左键工具", "工具栏切换：笔画 | 圆 | 选择+修改");
  logDemoStatus("右键工具", "矩形框选 -> 修改对象");
  logDemoStatus("空格工具", "随机圆对象");
  logDemoStatus("视口快捷键", "方向键平移，+/- 缩放，R 全屏刷新");

  const demoResults = configureWhiteboardDemo(board, viewport, {
    viewportTool,
  });

  setupToolSwitcher(board, viewport, demoResults);

  const resizeViewport = () => {
    const width = appLeft.clientWidth;
    const height = window.innerHeight;
    viewport.rootElement.style.width = `${width}px`;
    viewport.rootElement.style.height = `${height}px`;
    viewport.resizeRenderLayers(width, height);
  };

  resizeViewport();

  /**
   * 统一指针事件处理器（替换 mouse + touch 两套）
   * @description
   * 使用 Pointer Events 统一处理鼠标、触摸和笔输入。
   * `setPointerCapture` 保证指针离开 canvas 后仍能收到后续事件（替代 window mouseup 监听）。
   * 路由：mouse pointerType → mouse device；touch/pen → touchscreen device。
   * @param {PointerEvent} event
   * @returns {void}
   */
  const emitPointerPacket = (event) => {
    event.preventDefault();
    const rect = viewport.canvas.getBoundingClientRect();
    const signals = [];

    // pointerdown 时 capture 该指针，确保 pointermove/up 持续送达 canvas
    if (event.type === "pointerdown") {
      viewport.canvas.setPointerCapture(event.pointerId);
      if (event.pointerType === "mouse") {
        if (event.button === 0) {
          const activeBtn = document.querySelector(".toolbar-btn.active");
          const toolLabel = activeBtn?.textContent?.trim() ?? "笔画";
          logDemoStatus("当前输入", `左键 ${toolLabel}`);
        } else if (event.button === 2) {
          logDemoStatus("当前输入", "右键选择-修改");
        } else {
          logDemoStatus("当前输入", "鼠标输入");
        }
      } else {
        logDemoStatus("当前输入", `触摸指针 ${event.pointerId}`);
      }
    }

    const canvasPos = new Vector(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );

    const baseContext = {
      value: canvasPos,
      pointerId: String(event.pointerId),
      button: event.button,
      buttons: event.buttons,
      pointerType: event.pointerType,
      domEvent: event.type,
      ctrlKey: Boolean(event.ctrlKey),
      shiftKey: Boolean(event.shiftKey),
      altKey: Boolean(event.altKey),
      metaKey: Boolean(event.metaKey),
    };

    if (
      event.type === "pointerdown" ||
      event.type === "pointermove"
    ) {
      signals.push({ type: "position", context: { ...baseContext } });
    }

    if (event.type === "pointerup" || event.type === "pointerleave") {
      signals.push({ type: "end", context: { ...baseContext } });
    }

    if (event.type === "pointercancel") {
      signals.push({ type: "cancel", context: { ...baseContext } });
    }

    if (signals.length === 0) return;

    // 鼠标 → mouse device，触摸/笔 → touchscreen device
    const devicePath =
      event.pointerType === "mouse"
        ? `/${viewport.viewportId}/mouse`
        : `/${viewport.viewportId}/touchscreen`;

    board.signalsEventBus.emit("input", {
      to: devicePath,
      signals,
    });
  };

  viewport.canvas.addEventListener("pointerdown", emitPointerPacket);
  viewport.canvas.addEventListener("pointermove", emitPointerPacket);
  viewport.canvas.addEventListener("pointerup", emitPointerPacket);
  viewport.canvas.addEventListener("pointerleave", emitPointerPacket);
  viewport.canvas.addEventListener("pointercancel", emitPointerPacket);
  viewport.canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  viewport.canvas.addEventListener("dragstart", (event) => {
    event.preventDefault();
  });
  viewport.canvas.addEventListener("selectstart", (event) => {
    event.preventDefault();
  });

  const keyboardInputCodes = new Set(DEMO_KEYBOARD_INPUT_CODES);

  const shouldHandleKeyboardEvent = (event) => {
    if (event.metaKey || event.ctrlKey) {
      return false;
    }

    return keyboardInputCodes.has(event.code);
  };

  const emitKeyboardPacket = (event) => {
    if (!shouldHandleKeyboardEvent(event)) return;

    event.preventDefault();
    if (event.type === "keydown") {
      if (event.code === "Space") {
        logDemoStatus("当前输入", "空格随机圆");
      } else if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Equal",
          "Minus",
          "NumpadAdd",
          "NumpadSubtract",
          "KeyR",
        ].includes(event.code)
      ) {
        logDemoStatus("当前输入", `viewport ${event.code}`);
      } else if (
        ["KeyC", "KeyO", "KeyM", "KeyB", "KeyT"].includes(event.code)
      ) {
        logDemoStatus("当前输入", `debug ${event.code}`);
      } else if (event.code === "Enter") {
        logDemoStatus("当前输入", "成功提交（handoff + tool-switcher）");
      } else if (event.code === "Escape") {
        logDemoStatus("当前输入", "取消修改（handoff + tool-switcher）");
      } else if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
        logDemoStatus("当前输入", `WASD ${event.code}`);
      } else {
        logDemoStatus("当前输入", `keyboard ${event.code}`);
      }
    }

    board.signalsEventBus.emit("input", {
      to: `/${viewport.viewportId}/keyboard`,
      signals: [
        {
          type: event.type,
          context: {
            key: event.key,
            code: event.code,
            repeat: Boolean(event.repeat),
            ctrlKey: Boolean(event.ctrlKey),
            shiftKey: Boolean(event.shiftKey),
            altKey: Boolean(event.altKey),
            metaKey: Boolean(event.metaKey),
            domEvent: event.type,
          },
        },
      ],
    });

    // Enter/Escape → 也发一份到 tool-switcher，让当前激活工具（如 select-handoff 的 modifier）响应
    // 这里不走 keyboard device，是因为它不是设备语义的键盘输入
    if (event.code === "Enter" || event.code === "Escape") {
      const signalType = event.code === "Enter" ? "success" : "cancel";
      board.signalsEventBus.emit("input", {
        to: `/${viewport.viewportId}/workflows/tool-switcher`,
        signals: [{ type: signalType, context: {} }],
      });
    }
  };

  const emitKeyboardCancelPacket = () => {
    board.signalsEventBus.emit("input", {
      to: `/${viewport.viewportId}/keyboard`,
      signals: [{ type: "end", context: { domEvent: "blur" } }],
    });
  };

  viewport.canvas.addEventListener("pointerdown", () => {
    viewport.canvas.focus();
  });
  viewport.canvas.addEventListener("keydown", emitKeyboardPacket);
  viewport.canvas.addEventListener("keyup", emitKeyboardPacket);
  viewport.canvas.addEventListener("blur", emitKeyboardCancelPacket);
  window.addEventListener("resize", resizeViewport);

  viewport.canvas.focus();
}

/**
 * 设置工具切换（按钮组 + tool-switcher prefix）
 * @description
 * 绑定 DOM 工具栏按钮事件，创建按钮组设备和 tool-switcher prefix，
 * 替换原有的 mouse/primary → primary-stroke 为双输入汇聚的 tool-switcher 工作流。
 * @param {Board} board - 白板实例
 * @param {import("../core/ui/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {{ primaryStrokeTool: import("../core/ui/devices-dag/tools/creator/stroke-creator.js").StrokeCreatorTool }} demoResults - configureWhiteboardDemo 的返回值
 * @returns {void}
 */
function setupToolSwitcher(board, viewport, demoResults) {
  const vpId = viewport.viewportId;
  const buttons = document.querySelectorAll(".toolbar-btn");
  if (!buttons.length) return;

  // 绑定 DOM 按钮事件
  for (const btn of buttons) {
    const toolName = btn.dataset.tool;
    if (!toolName) continue;

    btn.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      board.signalsEventBus.emit("input", {
        to: `/${vpId}/toolbar/button-group`,
        signals: [{ type: "button-press", context: { toolName } }],
      });
    });
  }

  // 采集工具名列表
  const tools = Array.from(buttons)
    .map((btn) => btn.dataset.tool)
    .filter(Boolean)
    .map((name) => ({ name }));

  // 1. 拆除原有 mouse/primary → primary-stroke 边
  board.signalsEventBus.emit("umount", {
    viewportId: vpId,
    name: "primary-stroke",
    edges: [{ from: "mouse/primary", edge: "default" }],
  });

  // 2. 创建按钮组设备
  const buttonGroupDef = createButtonGroupDevice({
    tools,
    defaultTool: buttons[0]?.dataset.tool ?? "stroke",
    onUpdate({ activeTool }) {
      buttons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tool === activeTool);
      });
    },
  });
  viewport.mountSubDAG("toolbar/button-group", buttonGroupDef);

  // 3. 创建并挂载 tool-switcher prefix
  const switcherSubDAG = createToolSwitcherSubDAG({
    tools,
    defaultTool: buttons[0]?.dataset.tool ?? "stroke",
  });
  board.signalsEventBus.emit("mount", {
    viewportId: vpId,
    name: DEMO_WORKFLOW_NAMES.TOOL_SWITCHER,
    workflow: switcherSubDAG,
    edges: [{ from: "mouse/primary", edge: "default" }],
  });

  const switcherPath = `/${vpId}/workflows/${DEMO_WORKFLOW_NAMES.TOOL_SWITCHER}`;

  // 4. 挂载笔画工具（重用 configureWhiteboardDemo 创建的实例）
  board.devicesDAG.addEdge(
    `${switcherPath}/stroke`,
    "default",
    `/${vpId}/workflows/primary-stroke`,
  );

  // 5. 挂载圆工具
  const circleCreatorTool = new CircleCreatorTool({
    property: { strokeColor: "#00aa00", strokeWidth: 2 },
  });
  const circleWorkflowName = `${DEMO_WORKFLOW_NAMES.TOOL_SWITCHER}/circle-tool`;
  board.signalsEventBus.emit("mount", {
    viewportId: vpId,
    name: circleWorkflowName,
    workflow: circleCreatorTool,
    edges: [],
  });
  board.devicesDAG.addEdge(
    `${switcherPath}/circle`,
    "default",
    `/${vpId}/workflows/${circleWorkflowName}`,
  );

  // 6. 挂载 handoff（选择→修改）
  const selectHandoffSubDAG = createHandoffSubDAG({
    rootPath: `/workflows/${DEMO_WORKFLOW_NAMES.TOOL_SWITCHER}/select-handoff`,
    first: new RectangleObjectChooserTool(),
    second: new CommonObjectModifierTool(),
    autoBridgeObjects: true,
  });
  const selectWorkflowName = `${DEMO_WORKFLOW_NAMES.TOOL_SWITCHER}/select-handoff`;
  board.signalsEventBus.emit("mount", {
    viewportId: vpId,
    name: selectWorkflowName,
    workflow: selectHandoffSubDAG,
    edges: [],
  });
  board.devicesDAG.addEdge(
    `${switcherPath}/select`,
    "default",
    `/${vpId}/workflows/${selectWorkflowName}`,
  );

  // 7. 建立双输入汇聚：toolbar/button-group → tool-switcher
  board.devicesDAG.addEdge(
    `/${vpId}/toolbar/button-group`,
    "default",
    switcherPath,
  );
}

void bootstrapWhiteboard().catch((error) => {
  console.error("[whiteboard] Failed to bootstrap whiteboard demo:", error);
});
