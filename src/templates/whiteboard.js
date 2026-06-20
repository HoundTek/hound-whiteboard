import { Vector } from "../core/utils/math.js";
import { Board } from "../core/components/index.js";
import { Logger } from "../utils/log/logger.js";
import { logBus } from "../utils/log/log-bus.js";
import { createConsolePrinter } from "../utils/log/console-printer.js";
import {
  configureWhiteboardDemo,
  DEMO_KEYBOARD_INPUT_CODES,
} from "./demo/whiteboard-demo.js";
import { MonitorViewportTool } from "./demo/monitor-viewport-tool.js";
import { WasdCoordinateTool } from "./demo/wasd-coordinate-tool.js";

// Demo 独立入口，需要手动注册控制台输出器
createConsolePrinter(logBus, { timestamps: true });

const board = new Board();
board.width = 800;
board.height = 600;

const appLeft = document.getElementById("app-left");
const foregroundLayer = document.getElementById("app-foreground-layer");
const monitor = board.createMonitor(
  foregroundLayer,
  {
    width: appLeft.clientWidth,
    height: window.innerHeight,
  },
  "monitor",
);
monitor.zoom = 1.0;
monitor.origin = new Vector(0, 0);
monitor.renderCanvas.tabIndex = 0;

const demoLog = new Logger("Demo", "INFO", logBus);

const logDemoStatus = (label, payload) => {
  if (payload === undefined) {
    demoLog.info(label);
    return;
  }

  demoLog.info(label, payload);
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

logDemoStatus("左键工具", "红色笔画对象");
logDemoStatus("右键工具", "矩形框选 -> 修改对象");
logDemoStatus("空格工具", "随机圆对象");
logDemoStatus("WASD 初始坐标", { x: 0, y: 0 });
logDemoStatus("视口快捷键", "方向键平移，+/- 缩放，R 全屏刷新");
configureWhiteboardDemo(board, monitor, {
  wasdCoordinateTool,
  monitorViewportTool,
});

const resizeMonitor = () => {
  const width = appLeft.clientWidth;
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
      logDemoStatus("当前输入", "左键红笔");
    } else if (event.button === 2) {
      logDemoStatus("当前输入", "右键选择-修改");
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
      type: "end",
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

const emitWindowMouseUpPacket = (event) => {
  board.signalsEventBus.emit("input", {
    to: `/${monitor.monitorId}/mouse`,
    signals: [
      {
        type: "end",
        context: {
          button: event.button,
          buttons: event.buttons,
          domEvent: event.type,
        },
      },
    ],
  });
};

monitor.canvas.addEventListener("mousedown", emitMousePacket);
monitor.canvas.addEventListener("mousemove", emitMousePacket);
monitor.canvas.addEventListener("mouseup", emitMousePacket);
window.addEventListener("mouseup", emitWindowMouseUpPacket);
monitor.canvas.addEventListener("mouseleave", emitMousePacket);
monitor.canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
monitor.canvas.addEventListener("dragstart", (event) => {
  event.preventDefault();
});
monitor.canvas.addEventListener("selectstart", (event) => {
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
    } else if (event.code === "Enter") {
      logDemoStatus("当前输入", "handoff Enter");
    } else if (event.code === "Escape") {
      logDemoStatus("当前输入", "handoff Escape");
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
    signals: [{ type: "end", context: { domEvent: "blur" } }],
  });
};

monitor.canvas.addEventListener("mousedown", () => {
  monitor.canvas.focus();
});
monitor.canvas.addEventListener("keydown", emitKeyboardPacket);
monitor.canvas.addEventListener("keyup", emitKeyboardPacket);
monitor.canvas.addEventListener("blur", emitKeyboardCancelPacket);
window.addEventListener("resize", resizeMonitor);

monitor.canvas.focus();
