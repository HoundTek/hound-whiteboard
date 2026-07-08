import { Vector } from "../../../utils/math.js";
import { intersectsRanges } from "../geometry.js";
import { RectangleRange } from "../rectangle.js";

describe("RectangleRange", () => {
  test("from 应统一处理点列输入", () => {
    const rectangle = RectangleRange.from([
      new Vector(2, 3),
      new Vector(-1, 4),
      new Vector(5, -2),
    ]);

    expect(rectangle.left).toBe(-1);
    expect(rectangle.top).toBe(-2);
    expect(rectangle.width).toBe(6);
    expect(rectangle.height).toBe(6);
  });

  test("边界接触也应判定为相交，因为存在公共部分", () => {
    const left = new RectangleRange(0, 0, 2, 2);
    const right = new RectangleRange(2, 0, 2, 2);

    expect(intersectsRanges(left, right)).toBe(true);
  });

  test("union 应返回两个矩形的最小包围盒", () => {
    const left = new RectangleRange(0, 0, 2, 2);
    const right = new RectangleRange(3, 1, 2, 4);

    expect(left.union(right)).toEqual(new RectangleRange(0, 0, 5, 5));
  });

  test("inflate 应按四周扩张矩形", () => {
    const rect = new RectangleRange(2, 3, 4, 5);

    expect(rect.inflate(2)).toEqual(new RectangleRange(0, 1, 8, 9));
  });

  test("fromRectLike 应统一处理 right/bottom 风格输入", () => {
    expect(
      RectangleRange.fromRectLike({ left: 2, top: 3, right: 8, bottom: 10 }),
    ).toEqual(new RectangleRange(2, 3, 6, 7));
  });
});