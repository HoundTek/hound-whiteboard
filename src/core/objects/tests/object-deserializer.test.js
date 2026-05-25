import { deserialize } from "../object-deserializer.js";
import { PolygonObject } from "../graph/polygon.js";
import { TextObject } from "../one-dim/text.js";
import { StrokeObject } from "../stroke/stroke.js";
import { Matrix, Vector } from "../../utils/math.js";

describe("object deserializer", () => {
  test("应能还原 PolygonObject", () => {
    const polygon = new PolygonObject(new Vector(3, 4), 12, 5, [
      new Vector(0, 0),
      new Vector(10, 0),
      new Vector(0, 20),
    ]);
    polygon.setTransform(new Matrix(0, 1, -1, 0));
    polygon.setProperty({
      fillColor: "#ff8800",
      strokeColor: "#224466",
      strokeWidth: 2,
    });

    const serialized = polygon.serialize();
    const restored = deserialize(serialized);

    expect(restored).toBeInstanceOf(PolygonObject);
    expect(serialized.ownerChunkId).toBe(5);
    expect(serialized.chunkId).toBeUndefined();
    expect(restored.serialize()).toEqual(serialized);
  });

  test("应能还原 TextObject", () => {
    const text = new TextObject(new Vector(8, 13), 2, 7);
    text.setTransform(new Matrix(1, 0.2, 0, 1));
    text.setText("hello whiteboard");
    text.setProperty({
      color: "#123456",
      size: 24,
      font: "HarmonyOS Sans",
      strokeWidth: 2,
    });
    text.setIhatLength(320);

    const serialized = text.serialize();
    const restored = deserialize(JSON.stringify(serialized));

    expect(restored).toBeInstanceOf(TextObject);
    expect(serialized.ownerChunkId).toBe(7);
    expect(serialized.chunkId).toBeUndefined();
    expect(restored.serialize()).toEqual(serialized);
  });

  test("应能还原 StrokeObject", () => {
    const stroke = new StrokeObject(new Vector(1, 2), 9, 11);
    stroke.setPathPoints([
      new Vector(0, 0),
      new Vector(5, 2),
      new Vector(7, 8),
    ]);
    stroke.setTransform(new Matrix(2, 0, 0, 2));
    stroke.setProperty({ color: "#00aaee", width: 5 });

    const serialized = stroke.serialize();
    const restored = deserialize(serialized);

    expect(restored).toBeInstanceOf(StrokeObject);
    expect(serialized.ownerChunkId).toBe(11);
    expect(serialized.chunkId).toBeUndefined();
    expect(restored.serialize()).toEqual(serialized);
  });

  test("未知类型应抛出错误", () => {
    expect(() => deserialize({ type: "UnknownObject" })).toThrow(
      "Unsupported object type: UnknownObject",
    );
  });
});
