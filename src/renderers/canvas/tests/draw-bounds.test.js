/**
 * @jest-environment node
 */

/**
 * @file 绘制边界不变式测试
 * @description 断言对象的实际着墨像素永远落在 `getRange()` 加 `getRenderPadding()` 的范围内，这是按包围盒局部失效成立的前提。
 * @module canvas/draw-bounds-test
 * @author Zhou Chenyu
 */

import { createCanvas } from "@napi-rs/canvas";

import { StrokeObject } from "../../../kernel/objects/stroke/stroke.js";
import { CircleObject } from "../../../kernel/objects/graph/circle.js";
import { EllipseObject } from "../../../kernel/objects/graph/ellipse.js";
import { Vector, Matrix } from "../../../kernel/utils/math.js";
import { RectangleRange } from "../../../kernel/range/rectangle.js";
import { drawObject } from "../object-draw-strategies.js";

const CANVAS_SIZE = 400;
const CENTER = CANVAS_SIZE / 2;

/**
 * 抗锯齿会让着墨越过几何边界约 1 像素，与渲染器的留白口径保持一致
 * @type {number}
 */
const RASTERIZATION_PADDING = 1;

/**
 * 计算画布上实际着墨像素的包围盒
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @returns {{ left: number, top: number, right: number, bottom: number } | null} 着墨包围盒
 */
function inkedBounds(ctx) {
  const data = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < CANVAS_SIZE; y++) {
    for (let x = 0; x < CANVAS_SIZE; x++) {
      if (data[(y * CANVAS_SIZE + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}

/**
 * 断言对象的着墨范围没有超出包围盒加留白
 * @param {Object} object - 待测对象
 * @param {string} label - 用例描述
 */
function expectPaintedWithinBounds(object, label) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawObject(ctx, object);

  const inked = inkedBounds(ctx);
  expect({ label, inked: Boolean(inked) }).toEqual({ label, inked: true });

  const range = RectangleRange.from(
    object.getRange().withPosition(object.position),
  );
  const padding = object.getRenderPadding() + RASTERIZATION_PADDING;

  expect({
    label,
    overflow: {
      left: Math.max(0, range.left - padding - inked.left),
      top: Math.max(0, range.top - padding - inked.top),
      right: Math.max(0, inked.right - (range.right + padding)),
      bottom: Math.max(0, inked.bottom - (range.bottom + padding)),
    },
  }).toEqual({ label, overflow: { left: 0, top: 0, right: 0, bottom: 0 } });
}

/**
 * 建一条以画布中心为原点的笔迹
 * @param {Object} [options={}] - 笔画配置
 * @returns {StrokeObject} 笔迹对象
 */
function createStroke(options = {}) {
  const points = options.points ?? [
    { x: -60, y: 0 },
    { x: 0, y: -60 },
    { x: 60, y: 0 },
  ];
  const stroke = new StrokeObject(
    1,
    new Vector(CENTER, CENTER),
    {
      color: "#000000",
      width: options.width ?? 8,
      lineJoin: options.lineJoin ?? "round",
      lineCap: options.lineCap ?? "round",
    },
    { points },
  );
  if (options.transform) stroke.setTransform(options.transform);
  return stroke;
}

describe("绘制边界不变式", () => {
  test("圆连接与圆端点落在包围盒内", () => {
    expectPaintedWithinBounds(createStroke(), "圆连接");
    expectPaintedWithinBounds(createStroke({ width: 40 }), "粗线圆连接");
    expectPaintedWithinBounds(createStroke({ lineCap: "butt" }), "平端点");
    expectPaintedWithinBounds(createStroke({ lineJoin: "bevel" }), "斜连接");
    expectPaintedWithinBounds(
      createStroke({ points: [{ x: -60, y: 60 }, { x: 0, y: -60 }, { x: 60, y: 60 }] }),
      "v 形锐角",
    );
    expectPaintedWithinBounds(
      createStroke({ points: [{ x: 0, y: 0 }], width: 20 }),
      "单点",
    );
    // 下面两组取值会被归一化成 round：若归一化删除，尖角会立刻超出边界
    expectPaintedWithinBounds(
      createStroke({ lineJoin: "miter", width: 40 }),
      "尖连接归一化后",
    );
    expectPaintedWithinBounds(
      createStroke({ lineCap: "square", width: 8 }),
      "方端点归一化后",
    );
  });

  test("变换后的笔迹仍然落在包围盒内", () => {
    expectPaintedWithinBounds(
      createStroke({ transform: new Matrix(2, 0, 0, 2) }),
      "缩放 2 倍",
    );
  });

  test("图形对象的描边与填充落在包围盒内", () => {
    const circle = new CircleObject(2, new Vector(CENTER, CENTER), {
      strokeColor: "#000000",
      fillColor: "rgba(0,0,0,0.4)",
      strokeWidth: 12,
    });
    circle.data.radius = 80;
    circle.calculateRectangle?.();
    expectPaintedWithinBounds(circle, "圆");

    const ellipse = new EllipseObject(3, new Vector(CENTER, CENTER), {
      strokeColor: "#000000",
      fillColor: "rgba(0,0,0,0.4)",
      strokeWidth: 12,
    });
    ellipse.data.radiusX = 90;
    ellipse.data.radiusY = 60;
    ellipse.calculateEllipse?.();
    expectPaintedWithinBounds(ellipse, "椭圆");
  });

  test("不支持保持该不变式的连接与端点取值", () => {
    // miter 尖角长度与包围盒无比例关系，square 端点的方角斜向超过半线宽留白
    expect(createStroke({ lineJoin: "miter" }).property.lineJoin).toBe("round");
    expect(createStroke({ lineCap: "square" }).property.lineCap).toBe("round");
  });
});
