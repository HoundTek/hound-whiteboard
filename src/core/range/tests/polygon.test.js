import { Matrix, Vector } from "../../utils/math.js";
import { intersectsRanges } from "../geometry.js";
import { PolygonRange } from "../polygon.js";
import { PathRange } from "../path.js";
import { RectangleRange } from "../rectangle.js";

describe("PolygonRange", () => {
  test("from 应可从 RectangleRange 生成点列", () => {
    const polygon = PolygonRange.from(new RectangleRange(0, 1, 4, 4));

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

  test("应支持与路径范围的相交判断", () => {
    const polygon = new PolygonRange([
      new Vector(0, 0),
      new Vector(4, 0),
      new Vector(4, 4),
      new Vector(0, 4),
    ]);
    const crossingPath = new PathRange([
      new Vector(-1, 2),
      new Vector(5, 2),
    ]);
    const separatedPath = new PathRange([
      new Vector(5, 5),
      new Vector(7, 5),
    ]);

    expect(intersectsRanges(polygon, crossingPath)).toBe(true);
    expect(intersectsRanges(polygon, separatedPath)).toBe(false);
  });
});