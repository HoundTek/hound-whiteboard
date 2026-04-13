import { deserialize } from "../object-deserializer.js";
import { PolygonObject } from "../graph/polygon.js";
import { TextObject } from "../one-dim/text.js";
import { StrokeObject } from "../stroke/stroke.js";
import { Matrix, Vector } from "../../../utils/math.js";

describe("object deserializer", () => {
  test("应能还原 PolygonObject", () => {
    const polygon = new PolygonObject(new Vector(3, 4), 12, 5, [
      new Vector(0, 0),
      new Vector(10, 0),
      new Vector(0, 20),
    ]);
    polygon.setTransform(new Matrix(0, 1, -1, 0));
    polygon.color = "#ff8800";

    const serialized = polygon.serialize();
    const restored = deserialize(serialized);

    expect(restored).toBeInstanceOf(PolygonObject);
    expect(restored.serialize()).toEqual(serialized);
  });

  test("应能还原 TextObject", () => {
    const text = new TextObject(new Vector(8, 13), 2, 7);
    text.setTransform(new Matrix(1, 0.2, 0, 1));
    text.setText("hello whiteboard");
    text.setTextProperty({
      color: "#123456",
      size: 24,
      font: "HarmonyOS Sans",
    });
    text.setIhatLength(320);

    const serialized = text.serialize();
    const restored = deserialize(JSON.stringify(serialized));

    expect(restored).toBeInstanceOf(TextObject);
    expect(restored.serialize()).toEqual(serialized);
  });

  test("应能还原 StrokeObject", () => {
    const stroke = new StrokeObject(new Vector(1, 2), 9, 11);
    stroke.setPoints([new Vector(0, 0), new Vector(5, 2), new Vector(7, 8)]);
    stroke.setTransform(new Matrix(2, 0, 0, 2));
    stroke.color = "#00aaee";

    const serialized = stroke.serialize();
    const restored = deserialize(serialized);

    expect(restored).toBeInstanceOf(StrokeObject);
    expect(restored.serialize()).toEqual(serialized);
  });

  test("未知类型应抛出错误", () => {
    expect(() => deserialize({ type: "UnknownObject" })).toThrow(
      "Unsupported object type: UnknownObject",
    );
  });
});
