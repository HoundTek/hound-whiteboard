import { Matrix, Vector } from "../utils/math.js";
import { TextObject } from "../core/objects/one-dim/text.js";
import { PolygonCreatorTool } from "../core/tools/creator/polygon.js";
import { CounterPool } from "../core/utils/counter-pool.js";
import { insertPoints } from "../core/utils/math-algorithm.js";
import { StrokeCreatorTool } from "../core/tools/creator/stroke.js";
import { Monitor } from "../core/components/monitor.js";
import { Board } from "../core/components/board.js";

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

const ctx = monitor.canvas.getContext("2d");
