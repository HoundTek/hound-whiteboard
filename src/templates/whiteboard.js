import { Matrix, Vector } from "../utils/math.js";
import { TextObject } from "../core/objects/one-dim/text.js";
import { PolygonCreatorTool } from "../core/tools/creator/polygon-creator.js";
import { CounterPool } from "../core/utils/counter-pool.js";
import { insertPoints } from "../core/utils/math-algorithm.js";
import { StrokeCreatorTool } from "../core/tools/creator/stroke-creator.js";
import { Monitor } from "../core/components/monitor.js";
import { Board } from "../core/components/board.js";
import { createDebuggerDevice } from "../core/devices/debugger-device.js";

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

monitor.mountDevice(
  "/debugger",
  createDebuggerDevice({
    onRecord(entry) {
      console.log("Debugger Device Record:", entry);
    },
  }),
);

board.signalsEventBus.emit("input", {
  to: "/monitor/debugger",
  signals: [
    {
      type: "greeting",
      context: {
        value: "Hello, Debugger Device!",
      },
    },
  ],
});
