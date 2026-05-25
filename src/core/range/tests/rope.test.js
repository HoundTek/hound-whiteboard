import { Vector } from "../../utils/math.js";
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
});