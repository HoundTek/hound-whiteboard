import { Matrix, Vector } from "../../utils/math.js";
import { intersectsRanges } from "../geometry.js";
import { EllipseRange } from "../ellipse.js";
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
});