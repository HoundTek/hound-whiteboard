const RenderManager = require("./components/render-manager.js");
const { Matrix } = require("../../rust-bindings/matrix");

const canvas = document.getElementById('canvas');

// 设置 canvas 的内部分辨率，使其与 CSS 尺寸匹配
// 这样可以避免内容被拉伸
canvas.width = 800;
canvas.height = 600;

let testRenderManager = new RenderManager(canvas);

const { Point } = require("./utils/basic-classes.js");
const creator = require("./utils/board-objects-creator.js");

let outerTriangle = creator.generetePolygonObject(new Point(0, 0), [new Point(0, 0), new Point(100, 100), new Point(0, 100)]);
outerTriangle.color = "#000000";
outerTriangle.setTransform(new Matrix(2, 0, 0, 2));
testRenderManager.renderObject(outerTriangle);

let innerTriangle = creator.generetePolygonObject(new Point(10, 20), [new Point(0, 0), new Point(70, 70), new Point(0, 70)]);
innerTriangle.color = "#ffffff";
testRenderManager.renderObject(innerTriangle);

testRenderManager.renderQuark({
  type: "text",
  position: { x: 100, y: 100 },
  transform: [[1, 0], [0, 1]],
  text: "Triangles with same color flock together.",
  font: "Maple Mono NF CN",
  size: 24,
  color: "#ff0000"
});
