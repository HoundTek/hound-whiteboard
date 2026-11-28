// SPDX-License-Identifier: MIT

import { Matrix, Vector } from "../../utils/math.js";
import { RectangleRange } from "../../range/index.js";
import { StrokeObject } from "../stroke/stroke.js";
import { CircleObject } from "../graph/circle.js";
import { EllipseObject } from "../graph/ellipse.js";
import { PolygonObject } from "../graph/polygon.js";
import { getSerializedObjectRange, getSerializedObjectWorldRect } from "../object-geometry.js";

describe("快照纯几何", () => {
  test("四类对象的快照范围与实例范围一致", () => {
    const transform = new Matrix(2, 0.3, -0.2, 1.5);
    const objects = [
      new StrokeObject("s", new Vector(10, 20), { width: 2 }, {
        points: [{ x: 0, y: 0 }, { x: 8, y: 3 }, { x: 2, y: 9 }],
      }),
      new CircleObject("c", new Vector(30, 40), {}, { radius: 4 }),
      new EllipseObject("e", new Vector(50, 60), {}, { radiusX: 5, radiusY: 2 }),
      new PolygonObject("p", new Vector(70, 80), {}, {
        points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 3, y: 6 }],
      }),
    ];

    for (const obj of objects) {
      obj.setTransform(transform);
      const snapshot = obj.serialize();
      expect(getSerializedObjectRange(snapshot)).toEqual(obj.getRange());
      expect(getSerializedObjectWorldRect(snapshot)).toEqual(
        RectangleRange.from(obj.getRange().withPosition(obj.position)),
      );
    }
  });

  test("空点列与零半径保持零尺寸", () => {
    const stroke = new StrokeObject("s", new Vector(0, 0), {}, { points: [] });
    const circle = new CircleObject("c", new Vector(0, 0), {}, { radius: 0 });

    expect(getSerializedObjectWorldRect(stroke.serialize()).width).toBe(0);
    expect(getSerializedObjectWorldRect(circle.serialize()).height).toBe(0);
  });
});
