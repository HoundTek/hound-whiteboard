import { Matrix, Vector } from "../../../utils/math.js";
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

  test("多边形完全包含另一多边形时应判定相交", () => {
    const outer = new PolygonRange([
      new Vector(0, 0),
      new Vector(8, 0),
      new Vector(8, 8),
      new Vector(0, 8),
    ]);
    const inner = new PolygonRange([
      new Vector(2, 2),
      new Vector(4, 2),
      new Vector(4, 4),
      new Vector(2, 4),
    ]);

    expect(intersectsRanges(outer, inner)).toBe(true);
  });

  test("两个多边形包围盒重叠但实际不相交时应判定不相交", () => {
    // L 形多边形，中间是空的
    const lShape = new PolygonRange([
      new Vector(0, 0),
      new Vector(6, 0),
      new Vector(6, 2),
      new Vector(2, 2),
      new Vector(2, 6),
      new Vector(0, 6),
    ]);
    // 放在 lShape 的缺口位置，实际不重叠
    const otherL = new PolygonRange([
      new Vector(3, 3),
      new Vector(5, 3),
      new Vector(5, 5),
      new Vector(3, 5),
    ]);

    expect(intersectsRanges(lShape, otherL)).toBe(false);
  });

  test("凹多边形包含内部小多边形时应判定相交", () => {
    // 凹多边形（C 形）
    const concave = new PolygonRange([
      new Vector(0, 0),
      new Vector(8, 0),
      new Vector(8, 8),
      new Vector(6, 8),
      new Vector(6, 2),
      new Vector(0, 2),
    ]);
    // 小多边形在凹多边形的实心区域内
    const small = new PolygonRange([
      new Vector(1, 1),
      new Vector(3, 1),
      new Vector(3, 1.5),
      new Vector(1, 1.5),
    ]);

    expect(intersectsRanges(concave, small)).toBe(true);
  });
});
