const { PolygonObject } = require("./polygon");
const { Point, Matrix } = require("../../../../utils/math");

describe("PolygonObject", () => {
  test("构造函数应正确初始化顶点", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ].map((p) => Point.parse(p));
    const polygon = new PolygonObject(new Point(0, 0), 1, 1, points);
    expect(polygon.points).toEqual(points);
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

    expect(
      polygon.convexHull.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
    ).toEqual(
      expectedConvexHull.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
    );
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
