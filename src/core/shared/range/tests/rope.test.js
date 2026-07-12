import { Vector } from "../../../utils/math.js";
import { intersectsRanges } from "../geometry.js";
import { PolygonRange } from "../polygon.js";
import { RopeRange } from "../rope.js";

describe("RopeRange", () => {
  test("对重复缠绕的包含规则应与 PolygonRange 不同", () => {
    const twiceAroundSquare = [
      new Vector(0, 0),
      new Vector(4, 0),
      new Vector(4, 4),
      new Vector(0, 4),
      new Vector(0, 0),
      new Vector(4, 0),
      new Vector(4, 4),
      new Vector(0, 4),
    ];
    const point = new Vector(2, 2);

    expect(new PolygonRange(twiceAroundSquare).containsPoint(point)).toBe(false);
    expect(new RopeRange(twiceAroundSquare).containsPoint(point)).toBe(true);
  });

  test("绳子范围完全包含另一绳子范围时应判定相交", () => {
    const outer = new RopeRange([
      new Vector(0, 0),
      new Vector(8, 0),
      new Vector(8, 8),
      new Vector(0, 8),
    ]);
    const inner = new RopeRange([
      new Vector(2, 2),
      new Vector(4, 2),
      new Vector(4, 4),
      new Vector(2, 4),
    ]);

    expect(intersectsRanges(outer, inner)).toBe(true);
  });

  test("绳子范围与多边形完全包含时应判定相交", () => {
    const rope = new RopeRange([
      new Vector(0, 0),
      new Vector(8, 0),
      new Vector(8, 8),
      new Vector(0, 8),
    ]);
    const polygon = new PolygonRange([
      new Vector(2, 2),
      new Vector(4, 2),
      new Vector(4, 4),
      new Vector(2, 4),
    ]);

    expect(intersectsRanges(rope, polygon)).toBe(true);
  });
});
