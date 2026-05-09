import { Matrix, Vector } from "../utils/math.js";
import { TextObject } from "../core/objects/one-dim/text.js";
import { PolygonCreatorTool } from "../core/tools/creator/polygon-creator.js";
import { CounterPool } from "../core/utils/counter-pool.js";
import { insertPoints } from "../core/utils/math-algorithm.js";
import { StrokeCreatorTool } from "../core/tools/creator/stroke-creator.js";
import { Monitor } from "../core/components/monitor.js";
import { Board } from "../core/components/board.js";
import { Tool } from "../core/tools/tool.js";
import { createMouseDevice } from "../core/devices/mouse-device.js";
import {
  KEYBOARD_DEVICE_SIGNAL_TYPES,
  createKeyboardDevice,
} from "../core/devices/keyboard-device.js";

const board = new Board();
board.pageWidth = 800;
board.pageHeight = 600;

const foregroundLayer = document.getElementById("app-foreground-layer");
const monitor = board.createMonitor(
  foregroundLayer,
  {
    width: 800,
    height: 600,
  },
  "monitor",
);
monitor.zoom = 1.0;
monitor.origin = new Vector(0, 0);
monitor.canvas.tabIndex = 0;

class MouseTraceTool extends Tool {
  isDrawing = false;

  process(signalPacket, deviceContext = {}) {
    const monitorContext = deviceContext.monitor;
    const ctx = monitorContext?.canvas?.getContext?.("2d");
    if (!ctx || !monitorContext?.canvas) return;

    const positionSignal = signalPacket.signals.find(
      (signal) => signal.type === "position",
    );
    const position = positionSignal?.context?.value ?? null;
    const hasEnd = signalPacket.signals.some((signal) => signal.type === "end");
    const hasCancel = signalPacket.signals.some(
      (signal) => signal.type === "cancel",
    );

    if (position) {
      const rect = monitorContext.canvas.getBoundingClientRect();
      const canvasX = position.x - rect.left;
      const canvasY = position.y - rect.top;

      if (!this.isDrawing) {
        ctx.beginPath();
        ctx.moveTo(canvasX, canvasY);
        this.isDrawing = true;
      } else {
        ctx.lineTo(canvasX, canvasY);
      }

      ctx.strokeStyle = "#c0392b";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    if (hasEnd || hasCancel) {
      this.isDrawing = false;
    }
  }

  reset() {
    this.isDrawing = false;
  }
}

const mouseTraceTool = new MouseTraceTool();

class RandomCircleTool extends Tool {
  process(signalPacket, deviceContext = {}) {
    const monitorContext = deviceContext.monitor;
    const canvas = monitorContext?.canvas;
    const ctx = canvas?.getContext?.("2d");
    if (!ctx || !canvas) return;

    const shouldDraw = signalPacket.signals.some(
      (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
    );
    if (!shouldDraw) return;

    const radius = 12 + Math.random() * 48;
    const centerX = radius + Math.random() * Math.max(canvas.width - radius * 2, 0);
    const centerY = radius + Math.random() * Math.max(canvas.height - radius * 2, 0);
    const hue = Math.floor(Math.random() * 360);

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 75%, 60%, 0.22)`;
    ctx.strokeStyle = `hsl(${hue}, 70%, 42%)`;
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
  }

  reset() {}
}

const randomCircleTool = new RandomCircleTool();

monitor.mountDevice(
  "/mouse",
  createMouseDevice(),
);

monitor.mountDevice(
  "/keyboard",
  createKeyboardDevice(),
);

board.signalsEventBus.emit("mount", {
  to: `/${monitor.monitorId}/mouse/primary`,
  tool: mouseTraceTool,
});

board.signalsEventBus.emit("mount", {
  to: `/${monitor.monitorId}/keyboard/code/Space`,
  tool: randomCircleTool,
});

const emitMousePacket = (event) => {
  const baseContext = {
    value: { x: event.clientX, y: event.clientY },
    button: event.button,
    buttons: event.buttons,
    domEvent: event.type,
    ctrlKey: Boolean(event.ctrlKey),
    shiftKey: Boolean(event.shiftKey),
    altKey: Boolean(event.altKey),
    metaKey: Boolean(event.metaKey),
  };
  const signals = [];

  if (
    event.type === "mousedown" ||
    event.type === "mousemove" ||
    event.type === "mouseup"
  ) {
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
        button: event.button,
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

const emitKeyboardPacket = (event) => {
  if (event.code !== "Space") return;

  event.preventDefault();
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
