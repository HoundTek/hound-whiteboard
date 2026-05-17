import { Matrix, Vector } from "../core/utils/math.js";
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
  lastPoint = null;

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
        this.isDrawing = true;
        this.lastPoint = { x: canvasX, y: canvasY };
      } else {
        ctx.beginPath();
        ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
        ctx.lineTo(canvasX, canvasY);

        ctx.strokeStyle = "#c0392b";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();

        this.lastPoint = { x: canvasX, y: canvasY };
      }
    }

    if (hasEnd || hasCancel) {
      this.isDrawing = false;
      this.lastPoint = null;
    }
  }

  reset() {
    this.isDrawing = false;
    this.lastPoint = null;
  }
}

const mouseTraceTool = new MouseTraceTool();

const WASD_ROUTE_PRESETS = [
  {
    name: "standard",
    map: {
      KeyW: { x: 0, y: -1 },
      KeyA: { x: -1, y: 0 },
      KeyS: { x: 0, y: 1 },
      KeyD: { x: 1, y: 0 },
    },
  },
  {
    name: "rotated-clockwise",
    map: {
      KeyW: { x: 1, y: 0 },
      KeyA: { x: 0, y: -1 },
      KeyS: { x: -1, y: 0 },
      KeyD: { x: 0, y: 1 },
    },
  },
];

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
    const centerX =
      radius + Math.random() * Math.max(canvas.width - radius * 2, 0);
    const centerY =
      radius + Math.random() * Math.max(canvas.height - radius * 2, 0);
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

class WasdCoordinateTool extends Tool {
  position = { x: 0, y: 0 };

  process(signalPacket) {
    const movementSignals = signalPacket.signals.filter(
      (signal) => signal.type === "position",
    );
    if (movementSignals.length === 0) return;

    for (const signal of movementSignals) {
      const delta = signal?.context?.value;
      if (!delta) continue;

      this.position = {
        x: this.position.x + (delta.x ?? 0),
        y: this.position.y + (delta.y ?? 0),
      };
    }

    console.log("WASD cursor:", this.position);
  }

  reset() {
    this.position = { x: 0, y: 0 };
  }
}

const wasdCoordinateTool = new WasdCoordinateTool();
const keyboardDevice = createKeyboardDevice();
let wasdRoutePresetIndex = 0;

const buildWasdNodeConfig = (code, vector) => ({
  rewritePacket(packet) {
    const movementSignals = packet.signals
      .filter((signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER)
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
      to: "../../move",
      signals: movementSignals,
    };
  },
});

const applyWasdRoutePreset = (presetIndex) => {
  const normalizedIndex =
    ((presetIndex % WASD_ROUTE_PRESETS.length) + WASD_ROUTE_PRESETS.length) %
    WASD_ROUTE_PRESETS.length;
  const preset = WASD_ROUTE_PRESETS[normalizedIndex];

  for (const [code, vector] of Object.entries(preset.map)) {
    board.signalsEventBus.emit("configure", {
      to: `/${monitor.monitorId}/keyboard/code/${code}`,
      options: buildWasdNodeConfig(code, vector),
    });
  }

  wasdRoutePresetIndex = normalizedIndex;
  console.log(`WASD mapping preset: ${preset.name}`);
};

const toggleWasdRoutePreset = () => {
  applyWasdRoutePreset(wasdRoutePresetIndex + 1);
};

monitor.mountDevice("/mouse", createMouseDevice());

monitor.mountDevice("/keyboard", keyboardDevice);

applyWasdRoutePreset(wasdRoutePresetIndex);

board.signalsEventBus.emit("mount", {
  to: `/${monitor.monitorId}/mouse/primary`,
  tool: mouseTraceTool,
});

board.signalsEventBus.emit("mount", {
  to: `/${monitor.monitorId}/keyboard/code/Space`,
  tool: randomCircleTool,
});

board.signalsEventBus.emit("mount", {
  to: `/${monitor.monitorId}/keyboard/move`,
  tool: wasdCoordinateTool,
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

const keyboardInputCodes = new Set([
  "Space",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
]);

const emitKeyboardPacket = (event) => {
  if (event.type === "keydown" && event.code === "KeyR" && !event.repeat) {
    event.preventDefault();
    toggleWasdRoutePreset();
    return;
  }

  if (!keyboardInputCodes.has(event.code)) return;

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
