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
 * @description 含直角拐点与长直段，用于验证包围盒与实际绘制点列一致。
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

describe("StrokeObject 世界点列", () => {
  test("放大缩小时世界点列的点数与 data.points 一致", () => {
    const points = rightAnglePoints();
    for (const scale of [0.25, 1, 3, 8]) {
      const stroke = createStroke(points, {
        transform: new Matrix(scale, 0, 0, scale),
      });
      // 渲染点列与橡皮擦判定点列同一份数据：插点或抽稀都会改变几何与擦除语义
      expect(stroke.rich.worldPathRange.points).toHaveLength(points.length);
      expect(stroke.getRange().points).toHaveLength(points.length);
    }
  });

  test("变换只做坐标映射，不改变点列形状特征", () => {
    const points = rightAnglePoints();
    const stroke = createStroke(points, {
      transform: new Matrix(3, 0, 0, 3),
    });
    const worldPoints = stroke.rich.worldPathRange.points;
    // 直角拐点经过等比缩放后仍然是直角拐点
    expect(worldPoints[2].x).toBeCloseTo(300, 9);
    expect(worldPoints[2].y).toBeCloseTo(0, 9);
    expect(worldPoints[3].x).toBeCloseTo(300, 9);
    expect(worldPoints[3].y).toBeCloseTo(180, 9);
  });
});

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
