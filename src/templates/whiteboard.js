import { Matrix, Vector } from "../utils/math.js";
import { TextObject } from "../core/objects/one-dim/text.js";
import { PolygonCreatorTool } from "../core/tools/creator/polygon.js";
import { CounterPool } from "../core/utils/counter-pool.js";
import { insertPoints } from "../core/utils/math-algorithm.js";
import { StrokeCreatorTool } from "../core/tools/creator/stroke.js";
import { Monitor } from "../core/components/monitor.js";

const monitor = new Monitor();

monitor.canvas = document.createElement("canvas");
monitor.canvas.width = 800;
monitor.canvas.height = 600;

document.getElementById("app-foreground-layer").appendChild(monitor.canvas);
monitor.canvas.id = "canvas";

// 设置 canvas 的内部分辨率，使其与 CSS 尺寸匹配
// 这样可以避免内容被拉伸
const board = {
  width: 800,
  height: 600,
};

const ctx = monitor.canvas.getContext("2d");

console.log(board);

let tool = new PolygonCreatorTool();
let pool = new CounterPool();

tool.create(new Vector(0, 0), pool.generate(), 1);
let outerTriangle = tool.obj;
[
  { x: 0, y: 0 },
  { x: 0, y: 100 },
  { x: 100, y: 100 },
]
  .map((p) => Vector.parse(p))
  .forEach((p) => {
    // 模拟用户绘制过程（轻触）
    tool.start(p);
    tool.end(p);
  });
outerTriangle.color = "#000000";
outerTriangle.setTransform(new Matrix(2, 0, 0, 2));
outerTriangle.render(ctx);
console.log("outer triangle", outerTriangle);

tool = new PolygonCreatorTool();
tool.create(new Vector(10, 20), pool.generate(), 1);

let innerTriangle = tool.obj;
[
  { x: 0, y: 0 },
  { x: 0, y: 70 },
  { x: 70, y: 70 },
]
  .map((p) => Vector.parse(p))
  .forEach((p) => {
    // 模拟用户绘制过程（轻触）
    tool.start(p);
    tool.end(p);
  });
innerTriangle.color = "#ffffff";
innerTriangle.render(ctx);
console.log("inner triangle", innerTriangle);

let testText = new TextObject(new Vector(100, 100 - 24), 3, 1);
testText.setText("Triangles with same color flock together.", ctx);
testText.setTextProperty(
  { size: 24, color: "blue", font: "Maple Mono NF CN" },
  ctx,
);
testText.setIhatLength(600, ctx);
testText.render(ctx);

let helloText = new TextObject(new Vector(200, 200 - 32), 4, 1);
helloText.setText("Hello, Hound Whiteboard!", ctx);
helloText.setTextProperty(
  { size: 32, color: "green", font: "Maple Mono NF CN" },
  ctx,
);
helloText.setIhatLength(600, ctx);
helloText.render(ctx);

console.log("test text", testText);
console.log("hello text", helloText);

tool = new StrokeCreatorTool();
tool.create(new Vector(300, 300), pool.generate(), 1);
let stroke = tool.obj;
const strokePoints = insertPoints(
  [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 40, y: 0 },
    { x: 60, y: 0 },
    { x: 80, y: 0 },
    { x: 100, y: 0 },
    { x: 110, y: 10 },
    { x: 120, y: 20 },
    { x: 130, y: 30 },
  ].map((p) => Vector.parse(p)),
  0,
);
strokePoints.forEach((p) => {
  tool.start(p);
  tool.end(p);
});
stroke.color = "#ff0000";

stroke.setTransform(new Matrix(2, 0, 0, 1));

stroke.render(ctx);
