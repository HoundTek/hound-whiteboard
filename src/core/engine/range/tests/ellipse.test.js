import { Matrix, Vector } from "../../utils/math.js";
import { intersectsRanges } from "../geometry.js";
import { EllipseRange } from "../ellipse.js";
import { PathRange } from "../path.js";
import { RectangleRange } from "../rectangle.js";

describe("EllipseRange", () => {
  test("应支持包含判断和仿射变换", () => {
    const ellipse = new EllipseRange(new Vector(0, 0), 4, 2);
    const rotated = ellipse.transform(new Matrix(0, 1, -1, 0));

    expect(ellipse.containsPoint(new Vector(4, 0))).toBe(true);
    expect(ellipse.containsPoint(new Vector(5, 0))).toBe(false);
    expect(rotated.containsPoint(new Vector(0, 4))).toBe(true);
    expect(rotated.containsPoint(new Vector(4, 0))).toBe(false);
  });

  test("与外层面积范围存在公共部分时应判定为相交", () => {
    const outer = new RectangleRange(0, 0, 10, 10);
    const inner = new EllipseRange(new Vector(5, 5), 1, 1);

    expect(intersectsRanges(outer, inner)).toBe(true);
  });

  test("椭圆之间边界接触时也应判定相交", () => {
    const left = new EllipseRange(new Vector(0, 0), 2, 1);
    const right = new EllipseRange(new Vector(4, 0), 2, 1);
    const separated = new EllipseRange(new Vector(6.5, 0), 2, 1);

    expect(intersectsRanges(left, right)).toBe(true);
    expect(intersectsRanges(left, separated)).toBe(false);
  });

  test("旋转椭圆之间的边界穿越与分离应通过边界求根判定", () => {
    const axisX = new Vector(Math.SQRT2, Math.SQRT2);
    const axisY = new Vector(-Math.SQRT2 / 2, Math.SQRT2 / 2);
    const xSupport = Math.hypot(axisX.x, axisY.x);
    const left = new EllipseRange(
      new Vector(0, 0),
      axisX,
      axisY,
    );
    const crossing = new EllipseRange(
      new Vector(xSupport * 1.6, 0),
      axisX,
      axisY,
    );
    const separated = new EllipseRange(
      new Vector(xSupport * 2.4, 0),
      axisX,
      axisY,
    );

    expect(intersectsRanges(left, crossing)).toBe(true);
    expect(intersectsRanges(left, separated)).toBe(false);
  });

  test("同向旋转椭圆的外切基准构型应稳定成立", () => {
    const axisX = new Vector(Math.SQRT2, Math.SQRT2);
    const axisY = new Vector(-Math.SQRT2 / 2, Math.SQRT2 / 2);
    const left = new EllipseRange(new Vector(0, 0), axisX, axisY);
    const tangent = new EllipseRange(axisX.scale(2), axisX, axisY);
    const separated = new EllipseRange(axisX.scale(2.2), axisX, axisY);

    expect(intersectsRanges(left, tangent)).toBe(true);
    expect(intersectsRanges(left, separated)).toBe(false);
  });

  test("线段与椭圆的外切基准构型应稳定成立", () => {
    const ellipse = new EllipseRange(new Vector(0, 0), 4, 2);
    const tangentPath = new PathRange([
      new Vector(-3, 2),
      new Vector(3, 2),
    ]);
    const separatedPath = new PathRange([
      new Vector(-3, 2.2),
      new Vector(3, 2.2),
    ]);

    expect(intersectsRanges(ellipse, tangentPath)).toBe(true);
    expect(intersectsRanges(ellipse, separatedPath)).toBe(false);
  });

  test("极瘦椭圆的相交与分离应保持稳定", () => {
    const horizontal = new EllipseRange(new Vector(0, 0), 10, 0.1);
    const vertical = new EllipseRange(new Vector(0, 0), 0.1, 10);
    const far = new EllipseRange(new Vector(0, 10.3), 0.1, 10);

    expect(intersectsRanges(horizontal, vertical)).toBe(true);
    expect(intersectsRanges(horizontal, far)).toBe(false);
  });

  test("退化椭圆应回退到边界线段判定", () => {
    const degenerate = new EllipseRange(new Vector(0, 0), 3, 0);
    const rectangle = new RectangleRange(2, -1, 2, 2);
    const separated = new RectangleRange(4.5, -1, 1.5, 2);

    expect(intersectsRanges(degenerate, rectangle)).toBe(true);
    expect(intersectsRanges(degenerate, separated)).toBe(false);
  });
});