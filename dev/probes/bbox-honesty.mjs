/**
 * @file 对象绘制范围是否落在包围盒加留白之内
 * @description
 * 逐种配置光栅化对象（连接样式、端点样式、宽度、变换、半透明），
 * 比较实际着墨像素的包围盒与 `getRange()` 加 `getRenderPadding()` 的覆盖范围。
 * 这条不变式是"按包围盒局部失效"能否成立的前提。
 * @author Zhou Chenyu
 */
import { createCanvas } from "@napi-rs/canvas";
import { StrokeObject } from "../../src/kernel/objects/stroke/stroke.js";
import { CircleObject } from "../../src/kernel/objects/graph/circle.js";
import { EllipseObject } from "../../src/kernel/objects/graph/ellipse.js";

import { Vector } from "../../src/kernel/utils/math.js";
import { drawObject } from "../../src/renderers/canvas/object-draw-strategies.js";
import { RectangleRange } from "../../src/kernel/range/rectangle.js";

const SIZE = 600;
const CENTER = SIZE / 2;

/**
 * 计算像素画布上实际着墨的包围盒
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @returns {{ left: number, top: number, right: number, bottom: number } | null} 着墨包围盒
 */
function inkedBounds(ctx) {
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (data[(y * SIZE + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}

/**
 * 测量单个配置
 * @param {string} label - 配置名
 * @param {Object} options - 笔画配置
 */
function measure(label, options) {
  const points = (options.points ?? [
    { x: -80, y: 0 },
    { x: 0, y: -80 },
    { x: 80, y: 0 },
  ]).map((p) => new Vector(p.x, p.y));
  const stroke = new StrokeObject(1, new Vector(CENTER, CENTER), {
    color: "rgba(0,0,0,1)",
    width: options.width ?? 8,
    lineJoin: options.lineJoin ?? "round",
    lineCap: options.lineCap ?? "round",
  }, { points: points.map((p) => ({ x: p.x, y: p.y })) });
  if (options.transform) stroke.setTransform(options.transform);

  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SIZE, SIZE);
  drawObject(ctx, stroke);
  const inked = inkedBounds(ctx);
  if (!inked) {
    console.log(`${label.padEnd(28)} 未着墨`);
    return;
  }

  // PathRange 没有 left/width，用对象自己维护的包围盒
  const range = stroke.rich.boundingBox;
  const padding = stroke.getRenderPadding() + 1;
  const allowed = {
    left: CENTER + range.left - padding,
    top: CENTER + range.top - padding,
    right: CENTER + range.left + range.width + padding,
    bottom: CENTER + range.top + range.height + padding,
  };
  const over = Math.max(
    allowed.left - inked.left,
    allowed.top - inked.top,
    inked.right - allowed.right,
    inked.bottom - allowed.bottom,
  );
  console.log(
    `${label.padEnd(28)} 着墨 ${inked.left},${inked.top} ~ ${inked.right},${inked.bottom} | 允许 ${allowed.left.toFixed(1)},${allowed.top.toFixed(1)} ~ ${allowed.right.toFixed(1)},${allowed.bottom.toFixed(1)} | ${over <= 0 ? "内" : `超出 ${over.toFixed(2)}px`}`,
  );
}

measure("圆连接 + 圆端点 w=8", {});
measure("尖连接 + 圆端点 w=8", { lineJoin: "miter" });
measure("尖连接 w=40", { lineJoin: "miter", width: 40 });
measure("斜连接 w=8", { lineJoin: "bevel" });
measure("方端点 w=8", { lineCap: "square" });
measure("平端点 w=8", { lineCap: "butt" });
measure("圆端点 w=40", { width: 40 });
measure("单点 w=20", { points: [{ x: 0, y: 0 }], width: 20 });
measure("两点 v 形 w=8", { points: [{ x: -60, y: 60 }, { x: 0, y: -60 }, { x: 60, y: 60 }] });
const scale2 = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
measure("缩放 2 倍 w=8", { transform: scale2 });
measure("缩放 2 倍 + 尖连接 w=8", { transform: scale2, lineJoin: "miter" });

/**
 * 测量图形对象的着墨范围
 * @param {string} label - 配置名
 * @param {Object} object - 图形对象
 */
function measureShape(label, object) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SIZE, SIZE);
  drawObject(ctx, object);
  const inked = inkedBounds(ctx);
  // 渲染器实际使用的世界范围就是 getRange() 平移到对象位置
  const range = RectangleRange.from(object.getRange().withPosition(object.position));
  const padding = object.getRenderPadding() + 1;
  const allowed = {
    left: range.left - padding,
    top: range.top - padding,
    right: range.left + range.width + padding,
    bottom: range.top + range.height + padding,
  };
  const over = Math.max(
    allowed.left - inked.left,
    allowed.top - inked.top,
    inked.right - allowed.right,
    inked.bottom - allowed.bottom,
  );
  console.log(
    `${label.padEnd(28)} 着墨 ${inked.left},${inked.top} ~ ${inked.right},${inked.bottom} | 允许 ${allowed.left.toFixed(1)},${allowed.top.toFixed(1)} ~ ${allowed.right.toFixed(1)},${allowed.bottom.toFixed(1)} | ${over <= 0 ? "内" : `超出 ${over.toFixed(2)}px`}`,
  );
}

const circle = new CircleObject(2, new Vector(CENTER, CENTER), { strokeColor: "#000", fillColor: "rgba(0,0,0,0.4)", strokeWidth: 12 });
circle.data.radius = 80;
circle.calculateRectangle?.();
measureShape("圆 描边 12 填充半透明", circle);

const ellipse = new EllipseObject(4, new Vector(CENTER, CENTER), { strokeColor: "#000", fillColor: "rgba(0,0,0,0.4)", strokeWidth: 12 });
ellipse.data.radiusX = 90;
ellipse.data.radiusY = 60;
ellipse.calculateEllipse?.();
measureShape("椭圆 描边 12 填充半透明", ellipse);
