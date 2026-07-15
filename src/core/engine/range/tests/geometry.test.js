import { Vector } from "../../utils/math.js";
import { EllipseRange } from "../ellipse.js";
import { intersectsRanges } from "../geometry.js";
import { PathRange } from "../path.js";
import { PolygonRange } from "../polygon.js";
import { RectangleRange } from "../rectangle.js";
import { RopeRange } from "../rope.js";

function squarePoints(offsetX = 0, offsetY = 0, size = 4) {
  return [
    new Vector(offsetX, offsetY),
    new Vector(offsetX + size, offsetY),
    new Vector(offsetX + size, offsetY + size),
    new Vector(offsetX, offsetY + size),
  ];
}

const overlappingFactories = {
  rectangle: () => new RectangleRange(0, 0, 4, 4),
  polygon: () => new PolygonRange(squarePoints()),
  rope: () => new RopeRange(squarePoints()),
  ellipse: () => new EllipseRange(new Vector(2, 2), 2, 1.5),
  path: () => new PathRange([new Vector(-1, 2), new Vector(5, 2)]),
};

const separatedFactories = {
  rectangle: () => new RectangleRange(10, 10, 4, 4),
  polygon: () => new PolygonRange(squarePoints(10, 10)),
  rope: () => new RopeRange(squarePoints(10, 10)),
  ellipse: () => new EllipseRange(new Vector(12, 12), 2, 1.5),
  path: () => new PathRange([new Vector(10, 12), new Vector(14, 12)]),
};

const PAIRS = [
  ["rectangle", "rectangle"],
  ["rectangle", "polygon"],
  ["rectangle", "rope"],
  ["rectangle", "ellipse"],
  ["rectangle", "path"],
  ["polygon", "polygon"],
  ["polygon", "rope"],
  ["polygon", "ellipse"],
  ["polygon", "path"],
  ["rope", "rope"],
  ["rope", "ellipse"],
  ["rope", "path"],
  ["ellipse", "ellipse"],
  ["ellipse", "path"],
  ["path", "path"],
];

describe("intersectsRanges 类型特化", () => {
  test.each(PAIRS)(
    "%s 与 %s 存在公共部分时应判定相交",
    (leftType, rightType) => {
      expect(
        intersectsRanges(
          overlappingFactories[leftType](),
          overlappingFactories[rightType](),
        ),
      ).toBe(true);
    },
  );

  test.each(PAIRS)("%s 与 %s 分离时应判定不相交", (leftType, rightType) => {
    expect(
      intersectsRanges(
        overlappingFactories[leftType](),
        separatedFactories[rightType](),
      ),
    ).toBe(false);
  });
});
