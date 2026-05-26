import { Vector } from "../core/utils/math.js";
import { Board } from "../core/components/board.js";
import {
  configureWhiteboardDemo,
  DEMO_KEYBOARD_INPUT_CODES,
} from "./demo/whiteboard-demo.js";
import { MonitorViewportTool } from "./demo/monitor-viewport-tool.js";
import { WasdCoordinateTool } from "./demo/wasd-coordinate-tool.js";

const board = new Board();
board.width = 800;
board.height = 600;

const foregroundLayer = document.getElementById("app-foreground-layer");
const monitor = board.createMonitor(
  foregroundLayer,
  {
    width: window.innerWidth,
    height: window.innerHeight,
  },
  "monitor",
);
monitor.zoom = 1.0;
monitor.origin = new Vector(0, 0);
monitor.liveCanvas.tabIndex = 0;

const logDemoStatus = (label, payload) => {
  if (payload === undefined) {
    console.log(`[whiteboard-demo] ${label}`);
    return;
  }

  console.log(`[whiteboard-demo] ${label}`, payload);
};

const wasdCoordinateTool = new WasdCoordinateTool({
  logPosition: false,
  onPositionChange(position) {
    logDemoStatus("WASD 坐标", position.serialize());
  },
});
const monitorViewportTool = new MonitorViewportTool({
  onViewportChange(targetMonitor) {
    logDemoStatus("视口状态", {
      origin: targetMonitor.origin.serialize(),
      zoom: targetMonitor.zoom,
    });
  },
  onFlush(targetMonitor) {
    logDemoStatus("视口全屏刷新", {
      origin: targetMonitor.origin.serialize(),
      zoom: targetMonitor.zoom,
    });
  },
});

logDemoStatus("左键工具", "黑色笔划对象");
logDemoStatus("右键工具", "矩形框选对象");
logDemoStatus("空格工具", "随机圆对象");
logDemoStatus("WASD 初始坐标", { x: 0, y: 0 });
logDemoStatus("视口快捷键", "方向键平移，+/- 缩放，R 全屏刷新");
configureWhiteboardDemo(board, monitor, {
  wasdCoordinateTool,
  monitorViewportTool,
});

const resizeMonitor = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  monitor.rootElement.style.width = `${width}px`;
  monitor.rootElement.style.height = `${height}px`;
  monitor.resizeRenderLayers(width, height);
};

resizeMonitor();

const emitMousePacket = (event) => {
  const signals = [];

  if (event.type === "mousedown") {
    event.preventDefault();
    if (event.button === 0) {
      logDemoStatus("当前输入", "左键黑笔");
    } else if (event.button === 2) {
      logDemoStatus("当前输入", "右键矩形框选");
    } else {
      logDemoStatus("当前输入", "鼠标输入");
    }
  }

  if (
    event.type === "mousedown" ||
    event.type === "mousemove" ||
    event.type === "mouseup"
  ) {
    const worldPosition = monitor.screenToWorld(
      new Vector(event.clientX, event.clientY),
    );
    if (!worldPosition) return;

    const baseContext = {
      value: worldPosition,
      button: event.button,
      buttons: event.buttons,
      domEvent: event.type,
      ctrlKey: Boolean(event.ctrlKey),
      shiftKey: Boolean(event.shiftKey),
      altKey: Boolean(event.altKey),
      metaKey: Boolean(event.metaKey),
    };

    signals.push({ type: "position", context: baseContext });
  }

  if (event.type === "mouseup") {
    signals.push({
      type: "end",
      context: {
        button: event.button,
        buttons: event.buttons,
        domEvent: event.type,
      },
    });
  }

  if (event.type === "mouseleave") {
    signals.push({
      type: "cancel",
      context: {
        buttons: event.buttons,
        domEvent: event.type,
      },
    });
  }

  if (signals.length === 0) return;

  board.signalsEventBus.emit("input", {
    to: `/${monitor.monitorId}/mouse`,
    signals,
  });
};

monitor.liveCanvas.addEventListener("mousedown", emitMousePacket);
monitor.liveCanvas.addEventListener("mousemove", emitMousePacket);
window.addEventListener("mouseup", emitMousePacket);
monitor.liveCanvas.addEventListener("mouseleave", emitMousePacket);
monitor.liveCanvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
monitor.liveCanvas.addEventListener("dragstart", (event) => {
  event.preventDefault();
});
monitor.liveCanvas.addEventListener("selectstart", (event) => {
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
      event.code === "ArrowUp" ||
      event.code === "ArrowDown" ||
      event.code === "ArrowLeft" ||
      event.code === "ArrowRight" ||
      event.code === "Equal" ||
      event.code === "Minus" ||
      event.code === "NumpadAdd" ||
      event.code === "NumpadSubtract" ||
      event.code === "KeyR"
    ) {
      logDemoStatus("当前输入", `viewport ${event.code}`);
    } else if (
      event.code === "KeyC" ||
      event.code === "KeyO" ||
      event.code === "KeyM" ||
      event.code === "KeyB" ||
      event.code.startsWith("Digit")
    ) {
      logDemoStatus("当前输入", `debug ${event.code}`);
    } else {
      logDemoStatus("当前输入", `WASD ${event.code}`);
    }
  }

  board.signalsEventBus.emit("input", {
    to: `/${monitor.monitorId}/keyboard`,
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
};

const emitKeyboardCancelPacket = () => {
  board.signalsEventBus.emit("input", {
    to: `/${monitor.monitorId}/keyboard`,
    signals: [{ type: "cancel", context: { domEvent: "blur" } }],
  });
};

monitor.liveCanvas.addEventListener("mousedown", () => {
  monitor.liveCanvas.focus();
});
monitor.liveCanvas.addEventListener("keydown", emitKeyboardPacket);
monitor.liveCanvas.addEventListener("keyup", emitKeyboardPacket);
monitor.liveCanvas.addEventListener("blur", emitKeyboardCancelPacket);
window.addEventListener("resize", resizeMonitor);

monitor.liveCanvas.focus();
