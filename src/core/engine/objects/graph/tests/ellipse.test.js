import { jest } from "@jest/globals";
import { EllipseObject } from "../ellipse.js";
import { EllipseRange } from "../../../range/index.js";
import { Matrix, Vector } from "../../../utils/math.js";

describe("EllipseObject", () => {
  describe("构造与范围", () => {
    test("构造函数应正确初始化双轴半径、凸包和边界框", () => {
      const ellipse = new EllipseObject(
        1,
        new Vector(3, 4),
        {},
        { radiusX: 6, radiusY: 4 },
      );

      expect(ellipse.data.radiusX).toBe(6);
      expect(ellipse.data.radiusY).toBe(4);
      expect(ellipse.rich.convexHullRange).toBeInstanceOf(EllipseRange);
      expect(
        Vector.nearlyEq(ellipse.rich.convexHullRange.center, new Vector(0, 0)),
      ).toBe(true);
      expect(
        Vector.nearlyEq(ellipse.rich.convexHullRange.axisX, new Vector(6, 0)),
      ).toBe(true);
      expect(
        Vector.nearlyEq(ellipse.rich.convexHullRange.axisY, new Vector(0, 4)),
      ).toBe(true);
      expect(ellipse.rich.boundingBox.left).toBeCloseTo(-6);
      expect(ellipse.rich.boundingBox.top).toBeCloseTo(-4);
      expect(ellipse.rich.boundingBox.width).toBeCloseTo(12);
      expect(ellipse.rich.boundingBox.height).toBeCloseTo(8);
    });

    test("修改变换矩阵时应更新主范围和边界框", () => {
      const ellipse = new EllipseObject(
        1,
        new Vector(2, 3),
        {},
        { radiusX: 4, radiusY: 2 },
      );
      const mat = new Matrix(2, 0, 0, 3);

      ellipse.setTransform(mat);
      const range = ellipse.getRange();

      expect(ellipse.transform).toEqual(mat);
      expect(range).toBeInstanceOf(EllipseRange);
      expect(Vector.nearlyEq(range.center, new Vector(0, 0))).toBe(true);
      expect(Vector.nearlyEq(range.axisX, new Vector(8, 0))).toBe(true);
      expect(Vector.nearlyEq(range.axisY, new Vector(0, 6))).toBe(true);
      expect(ellipse.rich.boundingBox.left).toBeCloseTo(-8);
      expect(ellipse.rich.boundingBox.top).toBeCloseTo(-6);
      expect(ellipse.rich.boundingBox.width).toBeCloseTo(16);
      expect(ellipse.rich.boundingBox.height).toBeCloseTo(12);
    });
  });

  describe("序列化与解析", () => {
    test("应能正确序列化并解析椭圆对象", () => {
      const ellipse = new EllipseObject(
        7,
        new Vector(1, 2),
        {},
        { radiusX: 6, radiusY: 3 },
      );
      ellipse.setProperty({
        strokeColor: "#123456",
        fillColor: "#abcdef",
        strokeWidth: 5,
      });
      ellipse.setTransform(Matrix.identity().rotate(Math.PI / 6));

      const serialized = ellipse.serialize();
      const parsed = EllipseObject.parse(serialized);

      expect(serialized).toEqual({
        id: 7,
        position: { x: 1, y: 2 },
        transform: ellipse.transform.serialize(),
        property: {
          fillColor: "#abcdef",
          strokeColor: "#123456",
          strokeWidth: 5,
        },
        type: "EllipseObject",
        data: { radiusX: 6, radiusY: 3 },
      });
      expect(parsed).toBeInstanceOf(EllipseObject);
      expect(parsed.data.radiusX).toBe(6);
      expect(parsed.data.radiusY).toBe(3);
      expect(parsed.property).toEqual(serialized.property);
      expect(Vector.nearlyEq(parsed.position, new Vector(1, 2))).toBe(true);
      expect(parsed.transform).toEqual(ellipse.transform);
    });

    test("解析非 EllipseObject 类型时应抛出异常", () => {
      expect(() =>
        EllipseObject.parse({
          type: "CircleObject",
          position: { x: 0, y: 0 },
          transform: Matrix.identity().serialize(),
        }),
      ).toThrow(TypeError);
    });
  });

  describe("边界条件", () => {
    test("半径为 0 时 constructor 会初始化 boundingBox", () => {
      const ellipse = new EllipseObject(
        10,
        new Vector(5, 5),
        {},
        { radiusX: 0, radiusY: 0 },
      );

      expect(ellipse.data.radiusX).toBe(0);
      expect(ellipse.rich.boundingBox).toBeDefined();
    });

    test("未提供半径参数时 boundingBox 未初始化", () => {
      const ellipse = new EllipseObject(
        20,
        new Vector(10, 10),
        {},
        { radiusX: undefined, radiusY: undefined },
      );

      expect(ellipse.data.radiusX).toBeUndefined();
      expect(ellipse.rich.boundingBox).toBeUndefined();
    });

    test("setData 将半径收至 0 时应同步 boundingBox", () => {
      const ellipse = new EllipseObject(
        30,
        new Vector(0, 0),
        {},
        { radiusX: 10, radiusY: 5 },
      );
      expect(ellipse.rich.boundingBox.width).toBeGreaterThan(0);

      ellipse.setData({ radiusX: 0, radiusY: 0 });

      expect(ellipse.data.radiusX).toBe(0);
      expect(ellipse.rich.boundingBox.width).toBe(0);
      expect(ellipse.rich.boundingBox.height).toBe(0);
    });

    test("transform 后 getRange 应返回正确的全局投影", () => {
      const ellipse = new EllipseObject(
        40,
        new Vector(10, 20),
        {},
        { radiusX: 3, radiusY: 2 },
      );
      ellipse.setTransform(new Matrix(2, 0, 0, 2));

      const range = ellipse.getRange();
      expect(range).toBeInstanceOf(EllipseRange);
      expect(Vector.nearlyEq(range.center, new Vector(0, 0))).toBe(true);
      expect(Vector.nearlyEq(range.axisX, new Vector(6, 0))).toBe(true);
      expect(Vector.nearlyEq(range.axisY, new Vector(0, 4))).toBe(true);
    });
  });

  describe("渲染留白", () => {
    test("无 transform 时留白为描边宽度的一半", () => {
      const ellipse = new EllipseObject(
        50,
        new Vector(0, 0),
        { strokeWidth: 4 },
        { radiusX: 3, radiusY: 2 },
      );

      expect(ellipse.getRenderPadding()).toBe(2);
    });

    test("非均匀缩放 transform 时留白按最大轴向缩放", () => {
      const ellipse = new EllipseObject(
        51,
        new Vector(0, 0),
        { strokeWidth: 4 },
        { radiusX: 3, radiusY: 2 },
      );
      ellipse.setTransform(new Matrix(2, 0, 0, 1));

      expect(ellipse.getRenderPadding()).toBe(4);
    });
  });
});
