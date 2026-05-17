import { Vector } from "../../utils/math.js";
import { intersectsRanges } from "../geometry.js";
import { RectangleRange } from "../rectangle.js";

describe("RectangleRange", () => {
  test("from 应统一处理点列输入", () => {
    const rectangle = RectangleRange.from([
      new Vector(2, 3),
      new Vector(-1, 4),
      new Vector(5, -2),
    ]);

    expect(rectangle.minX).toBe(-1);
    expect(rectangle.minY).toBe(-2);
    expect(rectangle.maxX).toBe(5);
    expect(rectangle.maxY).toBe(4);
  });

  test("边界接触也应判定为相交，因为存在公共部分", () => {
    const left = new RectangleRange(0, 0, 2, 2);
    const right = new RectangleRange(2, 0, 4, 2);

    expect(intersectsRanges(left, right)).toBe(true);
  });
});