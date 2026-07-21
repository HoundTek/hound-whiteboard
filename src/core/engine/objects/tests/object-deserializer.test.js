import { deserialize } from "../object-deserializer.js";
import { PolygonObject } from "../graph/polygon.js";
import { EllipseObject } from "../graph/ellipse.js";
import { StrokeObject } from "../stroke/stroke.js";
import { Matrix, Vector } from "../../utils/math.js";

describe("object deserializer", () => {
  test("应能还原 PolygonObject", () => {
    const polygon = new PolygonObject(
      12,
      new Vector(3, 4),
      {},
      { points: [new Vector(0, 0), new Vector(10, 0), new Vector(0, 20)] },
    );
    polygon.setTransform(new Matrix(0, 1, -1, 0));
    polygon.setProperty({
      fillColor: "#ff8800",
      strokeColor: "#224466",
      strokeWidth: 2,
    });

    const serialized = polygon.serialize();
    const restored = deserialize(serialized);

    expect(restored).toBeInstanceOf(PolygonObject);
    expect(serialized.chunkId).toBeUndefined();
    expect(restored.serialize()).toEqual(serialized);
  });

  test("应能还原 StrokeObject", () => {
    const stroke = new StrokeObject(9, new Vector(1, 2));
    stroke.setData({ points: [
      new Vector(0, 0),
      new Vector(5, 2),
      new Vector(7, 8),
    ].map(p => ({ x: p.x, y: p.y })) });
    stroke.setTransform(new Matrix(2, 0, 0, 2));
    stroke.setProperty({ color: "#00aaee", width: 5 });

    const serialized = stroke.serialize();
    const restored = deserialize(serialized);

    expect(restored).toBeInstanceOf(StrokeObject);
    expect(serialized.chunkId).toBeUndefined();
    expect(restored.serialize()).toEqual(serialized);
  });

  test("应能还原 EllipseObject", () => {
    const ellipse = new EllipseObject(
      15,
      new Vector(2, 3),
      {},
      { radiusX: 8, radiusY: 4 },
    );
    ellipse.setTransform(new Matrix(2, 0, 0, 1));
    ellipse.setProperty({
      fillColor: "#ffeecc",
      strokeColor: "#334455",
      strokeWidth: 3,
    });

    const serialized = ellipse.serialize();
    const restored = deserialize(serialized);

    expect(restored).toBeInstanceOf(EllipseObject);
    expect(serialized.chunkId).toBeUndefined();
    expect(restored.serialize()).toEqual(serialized);
  });

  test("未知类型应抛出错误", () => {
    expect(() => deserialize({ type: "UnknownObject" })).toThrow(
      "Unsupported object type: UnknownObject",
    );
  });
});
