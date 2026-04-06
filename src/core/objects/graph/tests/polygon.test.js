import { PolygonObject } from "../polygon.js";
import { Point, Matrix } from "../../../../utils/math.js";

describe("PolygonObject", () => {
  describe("构造与属性修改", () => {
    test("构造函数应正确初始化顶点", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ].map((p) => Point.parse(p));

      const polygon = new PolygonObject(new Point(0, 0), 1, 1, points);
      expect(polygon.points).toEqual(points);
    });

    test("应能正确修改顶点", () => {
      const initialPoints = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, initialPoints);

      const newPoints = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
        { x: 1, y: 1 },
      ].map((p) => Point.parse(p));
      polygon.setPoints(newPoints);

      expect(polygon.points).toEqual(newPoints);
    });

    test("应能正确修改变换矩阵", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, points);

      const mat = Matrix.identity().scale(2, 2);
      polygon.setTransform(mat);

      expect(polygon.transform).toEqual(mat);
    });

    test("修改变换矩阵时应更新变换后的顶点", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, points);

      const mat = Matrix.identity().rotate(Math.PI / 2);
      polygon.setTransform(mat);
      const expectedTransformedPoints = points.map((p) =>
        Point.mulMatrix(mat, p)
      );

      for (let i = 0; i < expectedTransformedPoints.length; i++) {
        expect(polygon.transformedPoints[i].x).toBeCloseTo(
          expectedTransformedPoints[i].x
        );
        expect(polygon.transformedPoints[i].y).toBeCloseTo(
          expectedTransformedPoints[i].y
        );
      }
    });

    test("修改顶点时应继承上一次的变换矩阵", () => {
      const initialPoints = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, initialPoints);

      const mat = Matrix.identity().rotate(Math.PI / 4);
      polygon.setTransform(mat);

      const newPoints = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ].map((p) => Point.parse(p));
      polygon.setPoints(newPoints);

      const expectedTransformedPoints = newPoints.map((p) =>
        Point.mulMatrix(mat, p)
      );

      for (let i = 0; i < expectedTransformedPoints.length; i++) {
        expect(
          Point.nearlyEq(
            polygon.transformedPoints[i],
            expectedTransformedPoints[i]
          )
        ).toBe(true);
      }
    });
  });

  describe("凸包计算", () => {
    test("应更新顶点并重新计算凸包", () => {
      const initialPoints = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, initialPoints);

      const newPoints = [
        { x: 0, y: 0 },
        { x: 1, y: 0.5 },
        { x: 1.5, y: 0.2 },
        { x: 1.8, y: 0.8 },
        { x: 1.9, y: 1.5 },
        { x: 1.7, y: 1.8 },
        { x: 1.2, y: 1.9 },
        { x: 0.8, y: 1.7 },
        { x: 0.5, y: 1.2 },
        { x: 0.2, y: 0.8 },
        { x: 0.3, y: 0.3 },
        { x: 1.3, y: 0.3 },
        { x: 1.7, y: 0.4 },
        { x: 1.9, y: 0.6 },
        { x: 1.6, y: 1.3 },
        { x: 1.1, y: 1.7 },
        { x: 0.6, y: 1.6 },
        { x: 0.4, y: 1.1 },
        { x: 0.3, y: 0.6 },
        { x: 2, y: 0 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
        { x: 2, y: 1 },
      ].map((p) => Point.parse(p));

      // Powered by Graham scan algorithm
      polygon.setPoints(newPoints);

      // Powered by Geogebra & eyes
      const expectedConvexHull = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 1.9, y: 1.5 },
        { x: 1.7, y: 1.8 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ].map((p) => Point.parse(p));

      expect(polygon.convexHull).toEqual(expectedConvexHull);
    });

    test("当顶点少于3个时，凸包应等于顶点本身", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, points);

      const newPoints = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ].map((p) => Point.parse(p));
      polygon.setPoints(newPoints);

      expect(polygon.points).toEqual(newPoints);
      expect(polygon.convexHull).toEqual(newPoints);
    });
  });

  describe("点相交检测", () => {
    test("应正确判断点是否在多边形内", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, points);

      const insidePoint = Point.parse({ x: 2, y: 2 });
      const outsidePoint = Point.parse({ x: 5, y: 5 });
      const edgePoint = Point.parse({ x: 4, y: 2 });
      const vertexPoint = Point.parse({ x: 0, y: 0 });

      expect(polygon.isPointIntersect(insidePoint)).toBe(true);
      expect(polygon.isPointIntersect(outsidePoint)).toBe(false);
      expect(polygon.isPointIntersect(edgePoint)).toBe(true);
      expect(polygon.isPointIntersect(vertexPoint)).toBe(true);
    });

    test("应正确判断点是否在复杂多边形内", () => {
      // 五角星外面加个框
      const points = [
        { x: 2, y: 0 },
        { x: 2, y: 5 },
        { x: 4, y: 5 },
        { x: 4, y: 2 },
        { x: 1, y: 2 },
        { x: 1, y: 4 },
        { x: 5, y: 4 },
        { x: 5, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 6 },
        { x: 6, y: 6 },
        { x: 6, y: 0 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, points);

      const insidePoints = Array.from({ length: 6 }, (_, i) =>
        Array.from({ length: 6 }, (_, j) => {
          if (i === 0 && j === 0) return null;
          if (i === 1 && j === 0) return null;
          return Point.parse({ x: i + 0.5, y: j + 0.5 });
        })
      )
        .flat()
        .filter((p) => p !== null);

      for (let p of insidePoints) {
        expect(polygon.isPointIntersect(p)).toBe(true);
      }

      expect(polygon.isPointIntersect(Point.parse({ x: 0.5, y: 0.5 }))).toBe(
        false
      );
      expect(polygon.isPointIntersect(Point.parse({ x: 1.5, y: 0.5 }))).toBe(
        false
      );
    });

    test("应正确处理顶点更新后的多边形的点相交检测", () => {
      const initialPoints = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, initialPoints);

      const newPoints = [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ].map((p) => Point.parse(p));
      polygon.setPoints(newPoints);

      const insidePoint = Point.parse({ x: 3, y: 3 });
      const outsidePoint = Point.parse({ x: 0, y: 0 });

      expect(polygon.isPointIntersect(insidePoint)).toBe(true);
      expect(polygon.isPointIntersect(outsidePoint)).toBe(false);
    });

    test("应正确处理变换后的多边形的点相交检测", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(0, 0), 1, 1, points);

      const rotation = Matrix.identity().rotate(Math.PI / 4);
      polygon.setTransform(rotation);

      const insidePoint = Point.parse({ x: -1, y: 1 });
      const outsidePoint = Point.parse({ x: 5, y: 5 });

      expect(polygon.isPointIntersect(insidePoint)).toBe(true);
      expect(polygon.isPointIntersect(outsidePoint)).toBe(false);
    });

    test("应正确处理位置移动后的多边形的点相交检测", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ].map((p) => Point.parse(p));
      const polygon = new PolygonObject(new Point(10, 10), 1, 1, points);

      const insidePoint = Point.parse({ x: 12, y: 12 });
      const outsidePoint = Point.parse({ x: 5, y: 5 });

      expect(polygon.isPointIntersect(insidePoint)).toBe(true);
      expect(polygon.isPointIntersect(outsidePoint)).toBe(false);
    });
  });
});
