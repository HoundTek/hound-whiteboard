const { RenderManager } = require("../../core/components/render-manager");
const { Matrix, Point } = require("../../utils/math");
const creator = require("../../core/utils/board-objects-creator");
const { BoardManager } = require("../../core/components/board-manager");
const { PageManager } = require("../../core/components/page-manager");
const { Directory } = require("../../utils/io");

const board = new BoardManager();

ipc.on("board-opened", (event, path) => {
  console.log("In board-opened event. path: ", path);
  board.root = Directory.parse(path);
  // [todo] 文件流程已在 BoardManager 中完成
  // 由于该处是对 BoardManager 的测试，故不调用 load 方法
  // 而是手动完成加载
});

const canvas = document.getElementById("canvas");

// 设置 canvas 的内部分辨率，使其与 CSS 尺寸匹配
// 这样可以避免内容被拉伸
board.width = 800;
board.height = 600;
canvas.width = 800;
canvas.height = 600;

console.log(board);

let testRenderManager = new RenderManager(canvas);

let outerTriangle = creator.generetePolygonObject(new Point(0, 0), [
  new Point(0, 0),
  new Point(100, 100),
  new Point(0, 100),
]);
outerTriangle.color = "#000000";
outerTriangle.setTransform(new Matrix(2, 0, 0, 2));
testRenderManager.renderObject(outerTriangle);

let innerTriangle = creator.generetePolygonObject(new Point(10, 20), [
  new Point(0, 0),
  new Point(70, 70),
  new Point(0, 70),
]);
innerTriangle.color = "#ffffff";
testRenderManager.renderObject(innerTriangle);

testRenderManager.renderQuark({
  type: "text",
  position: { x: 100, y: 100 },
  transform: [
    [1, 0],
    [0, 1],
  ],
  text: "Triangles with same color flock together.",
  font: "Maple Mono NF CN",
  size: 24,
  color: "#ff0000",
});
