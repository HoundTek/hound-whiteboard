import { Matrix, Vector } from "../../utils/math.js";
import { PolygonRange } from "../polygon.js";
import { RectangleRange } from "../rectangle.js";

describe("PolygonRange", () => {
  test("from 应可从 RectangleRange 生成点列", () => {
    const polygon = PolygonRange.from(new RectangleRange(0, 1, 4, 5));

    expect(polygon.points).toHaveLength(4);
    expect(polygon.points.map((point) => point.serialize())).toEqual([
      { x: 0, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 5 },
      { x: 0, y: 5 },
    ]);
  });

  test("transform 应返回变换后的新多边形", () => {
    const polygon = new PolygonRange([
      new Vector(1, 0),
      new Vector(0, 1),
      new Vector(0, 0),
    ]);
    const rotated = polygon.transform(new Matrix(0, 1, -1, 0));

    expect(rotated.points.map((point) => point.serialize())).toEqual([
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});