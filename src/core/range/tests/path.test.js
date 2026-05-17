import { Vector } from "../../utils/math.js";
import { intersectsRanges } from "../geometry.js";
import { PathRange } from "../path.js";
import { RectangleRange } from "../rectangle.js";

describe("PathRange", () => {
  test("应与面积范围进行相交判断", () => {
    const rectangle = new RectangleRange(0, 0, 2, 2);
    const crossingPath = new PathRange([
      new Vector(-1, 1),
      new Vector(3, 1),
    ]);
    const separatedPath = new PathRange([
      new Vector(3, 3),
      new Vector(5, 3),
    ]);

    expect(intersectsRanges(crossingPath, rectangle)).toBe(true);
    expect(intersectsRanges(rectangle, separatedPath)).toBe(false);
  });
});