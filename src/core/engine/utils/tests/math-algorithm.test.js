import { Vector } from "../math.js";
import { calcConvexHull, ropeNailIntersect } from "../math-algorithm.js";

describe("math-algorithm", () => {
  describe("calcConvexHull", () => {
    test("应正确计算凸包", () => {
      const polygon = [
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
      ].map((p) => Vector.parse(p));

      // Powered by Graham scan algorithm
      const convexHull = calcConvexHull(polygon);

      // Powered by Geogebra & eyes
      const expectedConvexHull = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 1.9, y: 1.5 },
        { x: 1.7, y: 1.8 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ].map((p) => Vector.parse(p));

      expect(convexHull).toEqual(expectedConvexHull);
    });

    test("当顶点少于 3 个时，凸包应等于顶点本身", () => {
      const polygon = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ].map((p) => Vector.parse(p));
      const convexHull = calcConvexHull(polygon);

      expect(convexHull).toEqual(polygon);
    });
  });

  describe("ropeNailIntersect", () => {
    test("应正确判断绕绳的圈数", () => {
      const rope = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ].map((p) => Vector.parse(p));

      const insidePoint = Vector.parse({ x: 2, y: 2 });
      const outsidePoint = Vector.parse({ x: 5, y: 5 });
      const edgePoint = Vector.parse({ x: 4, y: 2 });
      const vertexPoint = Vector.parse({ x: 0, y: 0 });

      expect(ropeNailIntersect(rope, insidePoint)).toBe(1);
      expect(ropeNailIntersect(rope, outsidePoint)).toBe(0);
      expect(ropeNailIntersect(rope, edgePoint)).toBe(NaN);
      expect(ropeNailIntersect(rope, vertexPoint)).toBe(NaN);
    });

    test("应正确判断复杂多边形的绕绳圈数", () => {
      // 五角星外面加个框
      const rope = [
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
      ].map((p) => Vector.parse(p));
    });
  });
});
