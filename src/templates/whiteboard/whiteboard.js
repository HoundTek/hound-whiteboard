const { Matrix, Point } = require("../../utils/math");
const { BoardManager } = require("../../core/components/board-manager");
const { PageManager } = require("../../core/components/page-manager");
const { Directory } = require("../../utils/io");
const { PolygonObject } = require("../../core/objects/board/graph/polygon");
const { TextObject } = require("../../core/objects/board/text");

const board = new BoardManager();

ipc.on("board-opened", (event, path) => {
  console.log("In board-opened event. path: ", path);
  board.root = Directory.parse(path);
  // [todo] 文件流程已在 BoardManager 中完成
  // 由于该处是对 BoardManager 的测试，故不调用 load 方法
  // 而是手动完成加载
});

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// 设置 canvas 的内部分辨率，使其与 CSS 尺寸匹配
// 这样可以避免内容被拉伸
board.width = 800;
board.height = 600;
canvas.width = 800;
canvas.height = 600;

console.log(board);

let outerTriangle = new PolygonObject(new Point(0, 0), 1, 1);
outerTriangle.setPoints(
  [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 100 },
  ].map((p) => Point.parse(p))
);
outerTriangle.color = "#000000";
outerTriangle.setTransform(new Matrix(2, 0, 0, 2));
outerTriangle.render(ctx);

let innerTriangle = new PolygonObject(new Point(10, 20), 2, 1);
innerTriangle.setPoints(
  [
    { x: 0, y: 0 },
    { x: 0, y: 70 },
    { x: 70, y: 70 },
  ].map((p) => Point.parse(p))
);
innerTriangle.color = "#ffffff";
innerTriangle.render(ctx);

let testText = new TextObject(new Point(100, 100), 3, 1);
testText.text = "Triangles with same color flock together.";
testText.size = 24;
testText.color = "#ff0000";
testText.font = "Maple Mono NF CN";
testText.render(ctx);

let helloText = new TextObject(new Point(200, 200), 4, 1);
helloText.text = "Hello, Hound Whiteboard!";
helloText.size = 32;
helloText.color = "green";
helloText.font = "Maple Mono NF CN";
helloText.render(ctx);
