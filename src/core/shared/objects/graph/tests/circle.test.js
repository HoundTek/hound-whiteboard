import { jest } from "@jest/globals";
import { CircleObject } from "../circle.js";
import { EllipseRange } from "../../../range/index.js";
import { Matrix, Vector } from "../../../../utils/math.js";

describe("CircleObject", () => {
  describe("构造与范围", () => {
    test("构造函数应正确初始化半径、凸包和边界框", () => {
      const circle = new CircleObject(1, new Vector(3, 4), {}, { radius: 5 });

      expect(circle.data.radius).toBe(5);
      expect(circle.rich.convexHullRange).toBeInstanceOf(EllipseRange);
      expect(
        Vector.nearlyEq(circle.rich.convexHullRange.center, new Vector(0, 0)),
      ).toBe(true);
      expect(
        Vector.nearlyEq(circle.rich.convexHullRange.axisX, new Vector(5, 0)),
      ).toBe(true);
      expect(
        Vector.nearlyEq(circle.rich.convexHullRange.axisY, new Vector(0, 5)),
      ).toBe(true);
      expect(circle.rich.boundingBox.left).toBeCloseTo(-5);
      expect(circle.rich.boundingBox.top).toBeCloseTo(-5);
      expect(circle.rich.boundingBox.width).toBeCloseTo(10);
      expect(circle.rich.boundingBox.height).toBeCloseTo(10);
    });

    test("修改变换矩阵时应更新主范围和边界框", () => {
      const circle = new CircleObject(1, new Vector(2, 3), {}, { radius: 4 });
      const mat = new Matrix(2, 0, 0, 3);

      circle.setTransform(mat);
      const range = circle.getRange();

      expect(circle.transform).toEqual(mat);
      expect(range).toBeInstanceOf(EllipseRange);
      expect(Vector.nearlyEq(range.center, new Vector(0, 0))).toBe(true);
      expect(Vector.nearlyEq(range.axisX, new Vector(8, 0))).toBe(true);
      expect(Vector.nearlyEq(range.axisY, new Vector(0, 12))).toBe(true);
      expect(circle.rich.boundingBox.left).toBeCloseTo(-8);
      expect(circle.rich.boundingBox.top).toBeCloseTo(-12);
      expect(circle.rich.boundingBox.width).toBeCloseTo(16);
      expect(circle.rich.boundingBox.height).toBeCloseTo(24);
    });
  });

  describe("序列化与解析", () => {
    test("应能正确序列化并解析圆对象", () => {
      const circle = new CircleObject(7, new Vector(1, 2), {}, { radius: 6 });
      circle.setProperty({
        strokeColor: "#123456",
        fillColor: "#abcdef",
        strokeWidth: 5,
      });
      circle.setTransform(Matrix.identity().rotate(Math.PI / 6));

      const serialized = circle.serialize();
      const parsed = CircleObject.parse(serialized);

      expect(serialized).toEqual({
        id: 7,
        position: { x: 1, y: 2 },
        transform: circle.transform.serialize(),
        property: {
          fillColor: "#abcdef",
          strokeColor: "#123456",
          strokeWidth: 5,
        },
        type: "CircleObject",
        data: { radius: 6 },
      });
      expect(parsed).toBeInstanceOf(CircleObject);
      expect(parsed.data.radius).toBe(6);
      expect(parsed.property).toEqual(serialized.property);
      expect(Vector.nearlyEq(parsed.position, new Vector(1, 2))).toBe(true);
      expect(parsed.transform).toEqual(circle.transform);
    });

    test("解析非 CircleObject 类型时应抛出异常", () => {
      expect(() =>
        CircleObject.parse({
          type: "PolygonObject",
          position: { x: 0, y: 0 },
          transform: Matrix.identity().serialize(),
        }),
      ).toThrow(TypeError);
    });
  });

  describe("边界条件", () => {
    test("radius 为 0 时 constructor 会初始化 boundingBox", () => {
      const circle = new CircleObject(10, new Vector(5, 5), {}, { radius: 0 });

      expect(circle.data.radius).toBe(0);
      expect(circle.rich.boundingBox).toBeDefined();
    });

    test("未提供 radius 参数时 boundingBox 未初始化", () => {
      const circle = new CircleObject(
        20,
        new Vector(10, 10),
        {},
        { radius: undefined },
      );

      expect(circle.data.radius).toBeUndefined();
      expect(circle.rich.boundingBox).toBeUndefined();
    });

    test("setRadius(0) 应正确将 boundingBox 收至 0", () => {
      const circle = new CircleObject(30, new Vector(0, 0), {}, { radius: 10 });
      expect(circle.data.radius).toBe(10);
      expect(circle.rich.boundingBox.width).toBeGreaterThan(0);

      circle.setData({ radius: 0 });

      expect(circle.data.radius).toBe(0);
      expect(circle.rich.boundingBox.width).toBe(0);
      expect(circle.rich.boundingBox.height).toBe(0);
    });

    test("transform 后 getRange 应返回正确的全局投影", () => {
      const circle = new CircleObject(
        40,
        new Vector(10, 20),
        {},
        { radius: 3 },
      );
      circle.setTransform(new Matrix(2, 0, 0, 2));

      const range = circle.getRange();
      expect(range).toBeInstanceOf(EllipseRange);
      expect(Vector.nearlyEq(range.center, new Vector(0, 0))).toBe(true);
    });
  });
});
