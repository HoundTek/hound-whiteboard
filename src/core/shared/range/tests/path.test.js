import { Vector } from "../../../utils/math.js";
import { intersectsRanges } from "../geometry.js";
import { PathRange } from "../path.js";
import { PolygonRange } from "../polygon.js";
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

  test("路径之间共享线段点时也应判定相交", () => {
    const rising = new PathRange([
      new Vector(0, 0),
      new Vector(2, 2),
    ]);
    const falling = new PathRange([
      new Vector(0, 2),
      new Vector(2, 0),
    ]);
    const separated = new PathRange([
      new Vector(3, 0),
      new Vector(4, 1),
    ]);

    expect(intersectsRanges(rising, falling)).toBe(true);
    expect(intersectsRanges(rising, separated)).toBe(false);
  });

  test("路径端点落在另一条开放折线线段上时应判定相交", () => {
    // 水平路径: (0,0) → (4,0)
    const horizontal = new PathRange([
      new Vector(0, 0),
      new Vector(4, 0),
    ]);
    // 竖直路径端点 (2,0) 正好落在水平路径上
    const vertical = new PathRange([
      new Vector(2, 0),
      new Vector(2, 2),
    ]);
    // 分离路径，端点不在也不交叉
    const away = new PathRange([
      new Vector(5, 1),
      new Vector(6, 2),
    ]);

    expect(intersectsRanges(horizontal, vertical)).toBe(true);
    expect(intersectsRanges(horizontal, away)).toBe(false);
  });

  test("路径完全在多边形内时应判定相交", () => {
    const polygon = new PolygonRange([
      new Vector(0, 0),
      new Vector(8, 0),
      new Vector(8, 8),
      new Vector(0, 8),
    ]);
    const inside = new PathRange([
      new Vector(2, 2),
      new Vector(4, 2),
      new Vector(4, 4),
    ]);

    expect(intersectsRanges(polygon, inside)).toBe(true);
  });

  test("路径从多边形外穿入内部时应判定相交（边界穿越）", () => {
    const polygon = new PolygonRange([
      new Vector(0, 0),
      new Vector(4, 0),
      new Vector(4, 4),
      new Vector(0, 4),
    ]);
    // 第一个顶点在 Polygon 外，第二个在内，线段穿越边界
    const crossing = new PathRange([
      new Vector(-2, 2),
      new Vector(2, 2),
    ]);

    expect(intersectsRanges(polygon, crossing)).toBe(true);
  });

  test("路径完全在多边形外且包围盒重叠时应判定不相交", () => {
    const polygon = new PolygonRange([
      new Vector(0, 0),
      new Vector(4, 0),
      new Vector(4, 4),
      new Vector(0, 4),
    ]);
    // 路径的 AABB 与多边形 AABB 重叠但路径在外部
    const outside = new PathRange([
      new Vector(2, 5),
      new Vector(3, 6),
    ]);

    expect(intersectsRanges(polygon, outside)).toBe(false);
  });
});
