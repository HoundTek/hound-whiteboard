/**
 * @file 对象绘制策略
 * @description 按对象类型注册的 Canvas2D 绘制策略；kernel 对象只暴露数据，绘制知识收归渲染包。
 * @module canvas/object-draw-strategies
 * @author Zhou Chenyu
 */

import {
  StrokeObject,
  DEFAULT_STROKE_PROPERTY,
} from "../../kernel/objects/stroke/stroke.js";
import { CircleObject } from "../../kernel/objects/graph/circle.js";
import { EllipseObject } from "../../kernel/objects/graph/ellipse.js";
import { PolygonObject } from "../../kernel/objects/graph/polygon.js";
import { ObjectPathCache } from "./object-path-cache.js";

/**
 * 路径编译缓存
 * @description 全进程共用一份：Path2D 存世界坐标，跨视口、跨缩放、跨帧都能复用。
 * @type {ObjectPathCache}
 */
const pathCache = new ObjectPathCache();

/**
 * 取路径缓存统计
 * @returns {{ entries: number, bytes: number, builds: number, fallbacks: number }} 统计
 */
function getPathCacheStats() {
  return pathCache.stats();
}

/**
 * 绘制笔迹对象
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @param {StrokeObject} object - 笔迹对象
 */
function renderStroke(ctx, object) {
  if (
    !object.rich.localPathRange ||
    object.rich.localPathRange.points.length === 0
  ) {
    return;
  }

  const strokeWidth = object.property.width;
  if (!(Number.isFinite(strokeWidth) && strokeWidth > 0)) {
    return;
  }

  const transformedPoints = object.getWorldPathRange().points;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, object.position.x, object.position.y);
  ctx.strokeStyle = object.property.color;
  ctx.globalCompositeOperation = "source-over";
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = object.property.lineJoin ?? DEFAULT_STROKE_PROPERTY.lineJoin;
  ctx.lineCap = object.property.lineCap ?? DEFAULT_STROKE_PROPERTY.lineCap;
  ctx.beginPath();
  ctx.moveTo(transformedPoints[0].x, transformedPoints[0].y);
  if (transformedPoints.length === 1) {
    ctx.arc(0, 0, strokeWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = object.property.color;
    ctx.fill();
  } else {
    // 编译路径可跨帧、跨视口复用；环境不支持 Path2D 时回退到逐点构建
    const compiledPath = pathCache.acquire(object);
    if (compiledPath) {
      ctx.stroke(compiledPath);
    } else {
      for (let i = 1; i < transformedPoints.length; i++) {
        ctx.lineTo(transformedPoints[i].x, transformedPoints[i].y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * 在对象自身变换下填充/描边路径
 * @description 封装 fill/stroke 判定、变换设置与双段绘制；drawPath 只负责构建路径。
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @param {CircleObject | EllipseObject | PolygonObject} object - 图形对象
 * @param {(ctx: CanvasRenderingContext2D) => void} drawPath - 路径构建回调
 */
function withObjectTransform(ctx, object, drawPath) {
  const strokeWidth = object.property.strokeWidth;
  const shouldFill = Boolean(object.property.fillColor);
  const shouldStroke =
    Boolean(object.property.strokeColor) &&
    Number.isFinite(strokeWidth) &&
    strokeWidth > 0;

  if (!shouldFill && !shouldStroke) {
    return;
  }

  ctx.save();
  ctx.setTransform(
    object.transform.a,
    object.transform.b,
    object.transform.c,
    object.transform.d,
    object.position.x,
    object.position.y,
  );
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  drawPath(ctx);

  if (shouldFill) {
    ctx.fillStyle = object.property.fillColor;
    ctx.fill();
  }

  if (shouldStroke) {
    ctx.strokeStyle = object.property.strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * 绘制圆形对象
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @param {CircleObject} object - 圆形对象
 */
function renderCircle(ctx, object) {
  if (object.data.radius <= 0) {
    return;
  }

  withObjectTransform(ctx, object, () => {
    ctx.arc(0, 0, object.data.radius, 0, Math.PI * 2);
  });
}

/**
 * 绘制椭圆对象
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @param {EllipseObject} object - 椭圆对象
 */
function renderEllipse(ctx, object) {
  if (!(object.data.radiusX > 0) || !(object.data.radiusY > 0)) {
    return;
  }

  withObjectTransform(ctx, object, () => {
    ctx.ellipse(
      0,
      0,
      object.data.radiusX,
      object.data.radiusY,
      0,
      0,
      Math.PI * 2,
    );
  });
}

/**
 * 绘制多边形对象
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @param {PolygonObject} object - 多边形对象
 */
function renderPolygon(ctx, object) {
  if (
    !object.rich.localPolygonRange ||
    object.rich.localPolygonRange.points.length === 0
  ) {
    return;
  }

  const points = object.rich.localPolygonRange.points;
  withObjectTransform(ctx, object, () => {
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
  });
}

/**
 * 对象类型到绘制策略的注册表
 * @type {Map<Function, (ctx: CanvasRenderingContext2D, object: Object) => void>}
 */
const OBJECT_DRAW_STRATEGIES = new Map([
  [StrokeObject, renderStroke],
  [CircleObject, renderCircle],
  [EllipseObject, renderEllipse],
  [PolygonObject, renderPolygon],
]);

/**
 * 按对象类型分派绘制
 * @param {CanvasRenderingContext2D} ctx - 画布上下文
 * @param {Object} object - 要绘制的对象
 * @description 未注册类型抛出错误，与原抽象方法未实现的行为一致。
 */
function drawObject(ctx, object) {
  const strategy = OBJECT_DRAW_STRATEGIES.get(object.constructor);
  if (!strategy) {
    throw new Error("Method not implemented.");
  }
  strategy(ctx, object);
}

export { drawObject, OBJECT_DRAW_STRATEGIES, getPathCacheStats };
