// SPDX-License-Identifier: MIT

import { Matrix, Vector } from "../../../utils/math.js";
import { RectangleRange } from "../../../range/rectangle.js";
import { StrokeObject } from "../stroke.js";

/**
 * 创建笔画对象
 * @param {Array<{x: number, y: number}>} points - 局部点列
 * @param {{ position?: Vector, transform?: Matrix }} [options={}] - 额外选项
 * @returns {StrokeObject} 笔画对象
 */
function createStroke(points, options = {}) {
  const stroke = new StrokeObject(
    1,
    options.position ?? new Vector(0, 0),
    { width: 2 },
    { points },
  );
  if (options.transform) {
    stroke.setTransform(options.transform);
  }
  return stroke;
}

/**
 * 直角折线点列
 * @description 拐点处曲率突变的样条插值会跑到局部凸包外面，用来验证包围盒覆盖。
 * @returns {Array<{x: number, y: number}>} 点列
 */
function rightAnglePoints() {
  return [
    { x: 0, y: 0 },
    { x: 60, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 100, y: 100 },
  ];
}

/**
 * 判断外矩形是否完全包住内矩形
 * @param {RectangleRange} outer - 外矩形
 * @param {RectangleRange} inner - 内矩形
 * @returns {boolean} 是否包含
 */
function containsRect(outer, inner) {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

describe("StrokeObject#getRenderBounds", () => {
  test("包围盒应等于实际绘制点列的包围盒", () => {
    const stroke = createStroke(rightAnglePoints());

    const bounds = stroke.getRenderBounds();
    const actual = RectangleRange.from(stroke.rich.worldPathRange);

    expect(bounds.left).toBeCloseTo(actual.left, 9);
    expect(bounds.top).toBeCloseTo(actual.top, 9);
    expect(bounds.right).toBeCloseTo(actual.right, 9);
    expect(bounds.bottom).toBeCloseTo(actual.bottom, 9);
  });

  test("包围盒不含对象位置", () => {
    const bounds = createStroke(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      { position: new Vector(500, 700) },
    ).getRenderBounds();

    expect(bounds.left).toBeCloseTo(0, 9);
    expect(bounds.top).toBeCloseTo(0, 9);
    expect(bounds.width).toBeCloseTo(10, 9);
  });

  test("缩放后包围盒应覆盖样条插值的过冲，而不只是控制点凸包", () => {
    // scale > 1 时 calculateRichDatas 会经 insertPoints 插入样条点，
    // 插值会跑到控制点凸包外侧。若用凸包矩形当渲染包围盒，
    // 过冲的那一段会落在失效区域之外，留下残影。
    const stroke = createStroke(rightAnglePoints(), {
      transform: new Matrix(3, 0, 0, 3),
    });

    const bounds = stroke.getRenderBounds();
    const hullBounds = RectangleRange.from(
      stroke.rich.convexHullRange.transform(stroke.transform),
    );

    // 夹具自检：该形状在 scale=3 下确实存在过冲，旧的凸包矩形盖不住实际绘制点
    expect(containsRect(hullBounds, bounds)).toBe(false);
    // 真正的约束：渲染包围盒必须包住每一个实际绘制点
    for (const point of stroke.rich.worldPathRange.toPoints()) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.left - 1e-9);
      expect(point.x).toBeLessThanOrEqual(bounds.right + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(bounds.top - 1e-9);
      expect(point.y).toBeLessThanOrEqual(bounds.bottom + 1e-9);
    }
  });

  test("追加点后包围盒应随之更新", () => {
    const stroke = createStroke([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(stroke.getRenderBounds().right).toBeCloseTo(10, 9);

    stroke.appendListItem("points", { x: 40, y: 0 });

    expect(stroke.getRenderBounds().right).toBeCloseTo(40, 9);
  });

  test("点列为空时包围盒为零矩形", () => {
    const bounds = createStroke([]).getRenderBounds();

    expect(bounds.width).toBe(0);
    expect(bounds.height).toBe(0);
  });
});
