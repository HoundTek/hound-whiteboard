import { Vector } from "../core/utils/math.js";
import { BOARD_PERSISTENCE_MODES, Board } from "../core/components/board.js";
import {
  configureWhiteboardDemo,
  DEMO_KEYBOARD_INPUT_CODES,
} from "./demo/whiteboard-demo.js";
import { WasdCoordinateTool } from "./demo/wasd-coordinate-tool.js";

const board = new Board({
  persistenceMode: BOARD_PERSISTENCE_MODES.MEMORY,
});
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
monitor.canvas.tabIndex = 0;

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

logDemoStatus("左键工具", "黑色笔划对象");
logDemoStatus("右键工具", "红色笔划对象");
logDemoStatus("空格工具", "随机圆对象");
logDemoStatus("WASD 初始坐标", { x: 0, y: 0 });
configureWhiteboardDemo(board, monitor, { wasdCoordinateTool });

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
    if (event.button === 0) {
      logDemoStatus("当前输入", "左键黑笔");
    } else if (event.button === 2) {
      logDemoStatus("当前输入", "右键红笔");
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

monitor.canvas.addEventListener("mousedown", emitMousePacket);
monitor.canvas.addEventListener("mousemove", emitMousePacket);
window.addEventListener("mouseup", emitMousePacket);
monitor.canvas.addEventListener("mouseleave", emitMousePacket);
monitor.canvas.addEventListener("contextmenu", (event) => {
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
      event.code === "KeyQ" ||
      event.code === "KeyE" ||
      event.code === "KeyR" ||
      event.code === "KeyT" ||
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

monitor.canvas.addEventListener("mousedown", () => {
  monitor.canvas.focus();
});
monitor.canvas.addEventListener("keydown", emitKeyboardPacket);
monitor.canvas.addEventListener("keyup", emitKeyboardPacket);
monitor.canvas.addEventListener("blur", emitKeyboardCancelPacket);
window.addEventListener("resize", resizeMonitor);

monitor.canvas.focus();
