const { Point, Matrix } = require("./math");

describe("Point Class", () => {
  describe("构造函数", () => {
    test("应能正确创建点", () => {
      const p = new Point(3, 4);
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
    });

    test("应该接受负数", () => {
      const p = new Point(-5, -10);
      expect(p.x).toBe(-5);
      expect(p.y).toBe(-10);
    });

    test("应该接受小数", () => {
      const p = new Point(3.5, 4.2);
      expect(p.x).toBe(3.5);
      expect(p.y).toBe(4.2);
    });
  });

  describe("坐标访问和修改", () => {
    test("getter 应能正确返回坐标", () => {
      const p = new Point(10, 20);
      expect(p.x).toBe(10);
      expect(p.y).toBe(20);
    });

    test("setter 应能正确修改坐标", () => {
      const p = new Point(1, 2);
      p.x = 5;
      p.y = 10;
      expect(p.x).toBe(5);
      expect(p.y).toBe(10);
    });
  });

  describe("distanceTo", () => {
    test("应能正确计算距离", () => {
      const p1 = new Point(0, 0);
      const p2 = new Point(3, 4);
      expect(Point.distanceTo(p1, p2)).toBe(5);
    });

    test("应能计算到自己的距离为 0", () => {
      const p1 = new Point(5, 5);
      const p2 = new Point(5, 5);
      expect(Point.distanceTo(p1, p2)).toBe(0);
    });

    test("应能正确处理负坐标", () => {
      const p1 = new Point(-3, -4);
      const p2 = new Point(0, 0);
      expect(Point.distanceTo(p1, p2)).toBe(5);
    });

    test("distanceSq 应能正确计算距离的平方", () => {
      const p1 = new Point(0, 1);
      const p2 = new Point(3, 4);
      expect(Point.distanceSq(p1, p2)).toBe(18);
    });
  });

  describe("dotMul", () => {
    test("应能正确计算点乘", () => {
      const p1 = new Point(1, 2);
      const p2 = new Point(-2, 3);
      expect(p1.dotMul(p2)).toBe(4);
    });
  });

  describe("nearlyEq", () => {
    test("应能正确判断两点是否在精度范围内相等", () => {
      const p1 = new Point(5, 10);
      const p2 = new Point(5.0001, 10);
      expect(Point.nearlyEq(p1, p2, 0.0001)).toBe(true);
      expect(Point.nearlyEq(p1, p2, 0.0002)).toBe(true);
      expect(Point.nearlyEq(p1, p2, 0.00005)).toBe(false);
    });

    test("应能正确处理精度为零的情况", () => {
      const p1 = new Point(5, 10);
      const p2 = new Point(5, 10);
      const p3 = new Point(5.00001, 10);
      expect(p1).toEqual(p2);
      expect(Point.nearlyEq(p1, p2, 0)).toBe(true);
      expect(Point.nearlyEq(p1, p3, 0)).toBe(false);
    });

    test("应能正确处理精度为负的情况", () => {
      const p1 = new Point(5, 10);
      const p2 = new Point(5.0001, 10);
      expect(Point.nearlyEq(p1, p2, -0.0001)).toBe(true);
      expect(Point.nearlyEq(p1, p2, -0.0002)).toBe(true);
      expect(Point.nearlyEq(p1, p2, -0.00005)).toBe(false);
    });
  });

  describe("clonePoint", () => {
    test("应能创建独立的副本", () => {
      const p1 = new Point(1, 2);
      const p2 = p1.clonePoint();

      expect(p2.x).toBe(1);
      expect(p2.y).toBe(2);

      p2.x = 10;
      expect(p1.x).toBe(1);
      expect(p2.x).toBe(10);
    });
  });

  describe("add", () => {
    test("应能正确计算两点之和", () => {
      const p1 = new Point(1, 2);
      const p2 = new Point(3, 4);
      const p3 = p1.add(p2);
      expect(p3.x).toBe(4);
      expect(p3.y).toBe(6);
    });

    test("不应该修改原点", () => {
      const p1 = new Point(1, 2);
      const p2 = new Point(3, 4);
      p1.add(p2);
      expect(p1.x).toBe(1);
      expect(p1.y).toBe(2);
    });

    test("应能正确处理负数", () => {
      const p1 = new Point(5, 10);
      const p2 = new Point(-2, -3);
      const p3 = p1.add(p2);
      expect(p3.x).toBe(3);
      expect(p3.y).toBe(7);
    });
  });

  describe("sub", () => {
    test("应能正确计算两点之差", () => {
      const p1 = new Point(5, 8);
      const p2 = new Point(2, 3);
      const p3 = p1.sub(p2);
      expect(p3.x).toBe(3);
      expect(p3.y).toBe(5);
    });

    test("不应该修改原点", () => {
      const p1 = new Point(5, 8);
      const p2 = new Point(2, 3);
      p1.sub(p2);
      expect(p1.x).toBe(5);
      expect(p1.y).toBe(8);
    });

    test("应能正确处理负结果", () => {
      const p1 = new Point(1, 2);
      const p2 = new Point(5, 8);
      const p3 = p1.sub(p2);
      expect(p3.x).toBe(-4);
      expect(p3.y).toBe(-6);
    });
  });

  describe("serialize", () => {
    test("应能返回正确的 JSON 对象", () => {
      const p = new Point(3, 4);
      const json = p.serialize();
      expect(json).toEqual({ x: 3, y: 4 });
    });

    test("应能返回独立的对象", () => {
      const p = new Point(5, 10);
      const json = p.serialize();
      json.x = 100;
      expect(p.x).toBe(5); // 原点不应被修改
    });

    test("应能正确处理小数", () => {
      const p = new Point(3.14, 2.71);
      const json = p.serialize();
      expect(json.x).toBe(3.14);
      expect(json.y).toBe(2.71);
    });
  });

  describe("serializeToArray", () => {
    test("应能返回正确的数组", () => {
      const p = new Point(3, 4);
      const arr = p.serializeToArray();
      expect(arr).toEqual([3, 4]);
    });

    test("应能返回独立的数组", () => {
      const p = new Point(5, 10);
      const arr = p.serializeToArray();
      arr[0] = 100;
      expect(p.x).toBe(5); // 原点不应被修改
    });
  });

  describe("Point.parse", () => {
    test("应能从 JSON 对象创建点", () => {
      const p = Point.parse({ x: 3, y: 4 });
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
    });

    test("应能正确处理小数", () => {
      const p = Point.parse({ x: 3.14, y: 2.71 });
      expect(p.x).toBe(3.14);
      expect(p.y).toBe(2.71);
    });
  });

  describe("Point.parseFromArray", () => {
    test("应能从数组创建点", () => {
      const p = Point.parseFromArray([3, 4]);
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
    });

    test("应该只使用前两个元素", () => {
      const p = Point.parseFromArray([1, 2, 3, 4, 5]);
      expect(p.x).toBe(1);
      expect(p.y).toBe(2);
    });

    test("应该在数组长度不足时抛出错误", () => {
      expect(() => Point.parseFromArray([1])).toThrow();
      expect(() => Point.parseFromArray([])).toThrow();
    });
  });

  describe("toString", () => {
    test("应能返回正确的字符串表示", () => {
      const p = new Point(3, 4);
      expect(p.toString()).toBe("Point(3, 4)");
    });

    test("应能正确处理小数", () => {
      const p = new Point(3.5, 4.2);
      expect(p.toString()).toBe("Point(3.5, 4.2)");
    });
  });
});

describe("Matrix Class", () => {
  describe("构造函数", () => {
    test("应能正确创建矩阵", () => {
      const m = new Matrix(1, 2, 3, 4);
      expect(m.a).toBe(1);
      expect(m.b).toBe(2);
      expect(m.c).toBe(3);
      expect(m.d).toBe(4);
    });

    test("应能接受负数", () => {
      const m = new Matrix(-1, -2, -3, -4324);
      expect(m.a).toBe(-1);
      expect(m.b).toBe(-2);
      expect(m.c).toBe(-3);
      expect(m.d).toBe(-4324);
    });

    test("应能接受小数", () => {
      const m = new Matrix(1.2, 2.4, 3.1, 4.2);
      expect(m.a).toBe(1.2);
      expect(m.b).toBe(2.4);
      expect(m.c).toBe(3.1);
      expect(m.d).toBe(4.2);
    });
  });

  describe("矩阵内元素访问和修改", () => {
    test("getter 应能正确返回矩阵内元素", () => {
      const m = new Matrix(10, -2, 4.5, 2);
      expect(m.a).toBe(10);
      expect(m.b).toBe(-2);
      expect(m.c).toBe(4.5);
      expect(m.d).toBe(2);
    });

    test("setter 应能正确修改矩阵内元素", () => {
      const m = new Matrix(1, 0, 0, 1);
      m.a = 10;
      m.b = -2;
      m.c = 4.5;
      m.d = 2;
      expect(m.a).toBe(10);
      expect(m.b).toBe(-2);
      expect(m.c).toBe(4.5);
      expect(m.d).toBe(2);
    });

    test("get 方法应能正确获取矩阵内元素", () => {
      const m = new Matrix(10, -2, 4.5, 2);
      expect(m.get(0, 0)).toBe(10);
      expect(m.get(1, 0)).toBe(-2);
      expect(m.get(0, 1)).toBe(4.5);
      expect(m.get(1, 1)).toBe(2);
    });

    test("getFromArr 方法应能正确获取矩阵内元素", () => {
      const m = new Matrix(10, -2, 4.5, 2);
      expect(m.getFromArr([0, 0])).toBe(10);
      expect(m.getFromArr([1, 0])).toBe(-2);
      expect(m.getFromArr([0, 1])).toBe(4.5);
      expect(m.getFromArr([1, 1])).toBe(2);
    });
  });

  describe("cloneMatrix", () => {
    test("应该创建独立的副本", () => {
      const m1 = new Matrix(1, 2, 3, 4);
      const m2 = m1.cloneMatrix();

      expect(m2.a).toBe(1);
      expect(m2.b).toBe(2);
      expect(m2.c).toBe(3);
      expect(m2.d).toBe(4);

      m2.a = 10;
      expect(m1.a).toBe(1);
      expect(m2.a).toBe(10);
    });
  });

  describe("det", () => {
    test("应能正确计算行列式", () => {
      const m1 = new Matrix(1, 2, 3, 4);
      expect(m1.det()).toBe(-2); // 1*4 - 2*3 = -2
    });

    test("应能正确计算单位矩阵的行列式", () => {
      const m = Matrix.identity();
      expect(m.det()).toBe(1);
    });

    test("应能正确处理负数", () => {
      const m = new Matrix(-2, 3, 4, -5);
      expect(m.det()).toBe(-2); // -2*-5 - 3*4 = 10 - 12 = -2
    });

    test("应能正确处理小数", () => {
      const m = new Matrix(1.5, 2.5, 3.5, 4.5);
      expect(m.det()).toBeCloseTo(-2); // 1.5*4.5 - 2.5*3.5 = 6.75 - 8.75 = -2
    });
  });

  describe("add", () => {
    test("应能正确计算矩阵之和", () => {
      const m1 = new Matrix(1, 2, 3, 4);
      const m2 = new Matrix(5, 6, 7, 8);
      const m3 = m1.add(m2);
      expect(m3.a).toBe(6);
      expect(m3.b).toBe(8);
      expect(m3.c).toBe(10);
      expect(m3.d).toBe(12);
    });

    test("不应该修改原矩阵", () => {
      const m1 = new Matrix(1, 2, 3, 4);
      const m2 = new Matrix(5, 6, 7, 8);
      m1.add(m2);
      expect(m1.a).toBe(1);
      expect(m1.b).toBe(2);
      expect(m1.c).toBe(3);
      expect(m1.d).toBe(4);
    });

    test("应能正确处理负数", () => {
      const m1 = new Matrix(5, 10, 15, 20);
      const m2 = new Matrix(-2, -3, -4, -5);
      const m3 = m1.add(m2);
      expect(m3.a).toBe(3);
      expect(m3.b).toBe(7);
      expect(m3.c).toBe(11);
      expect(m3.d).toBe(15);
    });
  });

  describe("sub", () => {
    test("应能正确计算矩阵之差", () => {
      const m1 = new Matrix(5, 8, 10, 12);
      const m2 = new Matrix(2, 3, 4, 5);
      const m3 = m1.sub(m2);
      expect(m3.a).toBe(3);
      expect(m3.b).toBe(5);
      expect(m3.c).toBe(6);
      expect(m3.d).toBe(7);
    });

    test("不应该修改原矩阵", () => {
      const m1 = new Matrix(5, 8, 10, 12);
      const m2 = new Matrix(2, 3, 4, 5);
      m1.sub(m2);
      expect(m1.a).toBe(5);
      expect(m1.b).toBe(8);
      expect(m1.c).toBe(10);
      expect(m1.d).toBe(12);
    });

    test("应能正确处理负结果", () => {
      const m1 = new Matrix(1, 2, 3, 4);
      const m2 = new Matrix(5, 8, 10, 12);
      const m3 = m1.sub(m2);
      expect(m3.a).toBe(-4);
      expect(m3.b).toBe(-6);
      expect(m3.c).toBe(-7);
      expect(m3.d).toBe(-8);
    });
  });

  describe("mul", () => {
    test("应能正确计算矩阵乘法", () => {
      const m1 = new Matrix(1, 2, 3, 4);
      const m2 = new Matrix(5, 6, 7, 8);
      const m3 = m1.mul(m2);
      // [[1, 3], [2, 4]] * [[5, 7], [6, 8]]
      // = [[1 * 5 + 3 * 6, 1 * 7 + 3 * 8], [2 * 5 + 4 * 6, 2 * 7 + 4 * 8]]
      // = [[23, 31], [34, 46]]
      expect(m3.a).toBe(23);
      expect(m3.b).toBe(34);
      expect(m3.c).toBe(31);
      expect(m3.d).toBe(46);
    });

    test("不应该修改原矩阵", () => {
      const m1 = new Matrix(1, 2, 3, 4);
      const m2 = new Matrix(5, 6, 7, 8);
      m1.mul(m2);
      expect(m1.a).toBe(1);
      expect(m1.b).toBe(2);
      expect(m1.c).toBe(3);
      expect(m1.d).toBe(4);
    });

    test("应能正确处理单位矩阵", () => {
      const m1 = new Matrix(2, 3, 4, 5);
      const identity = Matrix.identity();
      const m2 = m1.mul(identity);
      expect(m2.a).toBe(2);
      expect(m2.b).toBe(3);
      expect(m2.c).toBe(4);
      expect(m2.d).toBe(5);
    });
  });

  describe("nearlyEq", () => {
    test("应能正确判断两矩阵是否在精度范围内相等", () => {
      const m1 = new Matrix(5, 10, 15, 20);
      const m2 = new Matrix(5.0001, 10, 15, 20);
      expect(Matrix.nearlyEq(m1, m2, 0.0001)).toBe(true);
      expect(Matrix.nearlyEq(m1, m2, 0.0002)).toBe(true);
      expect(Matrix.nearlyEq(m1, m2, 0.00005)).toBe(false);
    });

    test("应能正确处理精度为零的情况", () => {
      const m1 = new Matrix(5, 10, 15, 20);
      const m2 = new Matrix(5, 10, 15, 20);
      const m3 = new Matrix(5.00001, 10, 15, 20);
      expect(Matrix.nearlyEq(m1, m2, 0)).toBe(true);
      expect(Matrix.nearlyEq(m1, m3, 0)).toBe(false);
    });

    test("应能正确处理精度为负的情况", () => {
      const m1 = new Matrix(5, 10, 15, 20);
      const m2 = new Matrix(5.0001, 10, 15, 20);
      expect(Matrix.nearlyEq(m1, m2, -0.0001)).toBe(true);
      expect(Matrix.nearlyEq(m1, m2, -0.0002)).toBe(true);
      expect(Matrix.nearlyEq(m1, m2, -0.00005)).toBe(false);
    });

    test("应能判断所有元素都在精度范围内", () => {
      const m1 = new Matrix(1, 2, 3, 4);
      const m2 = new Matrix(1.0001, 2.0001, 3.0001, 4.0001);
      expect(Matrix.nearlyEq(m1, m2, 0.00015)).toBe(true);
      expect(Matrix.nearlyEq(m1, m2, 0.00005)).toBe(false);
    });
  });

  describe("toString", () => {
    test("应能返回正确的字符串表示", () => {
      const m = new Matrix(1, 2, 3, 4);
      expect(m.toString()).toBe("Matrix[[1, 3], [2, 4]]");
    });

    test("应该正确处理小数", () => {
      const m = new Matrix(1.5, 2.5, 3.5, 4.5);
      expect(m.toString()).toBe("Matrix[[1.5, 3.5], [2.5, 4.5]]");
    });

    test("应该正确处理负数", () => {
      const m = new Matrix(-1, -2, -3, -4);
      expect(m.toString()).toBe("Matrix[[-1, -3], [-2, -4]]");
    });
  });

  describe("Matrix.identity", () => {
    test("应能创建单位矩阵", () => {
      const m = Matrix.identity();
      expect(m.a).toBe(1);
      expect(m.b).toBe(0);
      expect(m.c).toBe(0);
      expect(m.d).toBe(1);
    });

    test("单位矩阵的行列式应该为1", () => {
      const m = Matrix.identity();
      expect(m.det()).toBe(1);
    });
  });

  describe("serialize", () => {
    test("应该返回正确的 JSON 对象", () => {
      const m = new Matrix(1, 2, 3, 4);
      const json = m.serialize();
      expect(json).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    });

    test("应该返回独立的对象", () => {
      const m = new Matrix(5, 10, 15, 20);
      const json = m.serialize();
      json.a = 100;
      expect(m.a).toBe(5); // 原矩阵不应被修改
    });

    test("应该正确处理小数", () => {
      const m = new Matrix(1.5, 2.5, 3.5, 4.5);
      const json = m.serialize();
      expect(json.a).toBe(1.5);
      expect(json.b).toBe(2.5);
      expect(json.c).toBe(3.5);
      expect(json.d).toBe(4.5);
    });
  });

  describe("serializeToArray", () => {
    test("应该返回正确的二维数组", () => {
      const m = new Matrix(1, 2, 3, 4);
      const arr = m.serializeToArray();
      expect(arr).toEqual([
        [1, 3],
        [2, 4],
      ]);
    });

    test("应该返回独立的数组", () => {
      const m = new Matrix(5, 10, 15, 20);
      const arr = m.serializeToArray();
      arr[0][0] = 100;
      expect(m.a).toBe(5); // 原矩阵不应被修改
    });

    test("应该正确处理小数", () => {
      const m = new Matrix(1.5, 2.5, 3.5, 4.5);
      const arr = m.serializeToArray();
      expect(arr[0][0]).toBe(1.5);
      expect(arr[0][1]).toBe(3.5);
      expect(arr[1][0]).toBe(2.5);
      expect(arr[1][1]).toBe(4.5);
    });
  });

  describe("Matrix.parse", () => {
    test("应该从 JSON 对象创建矩阵", () => {
      const m = Matrix.parse({ a: 1, b: 2, c: 3, d: 4 });
      expect(m.a).toBe(1);
      expect(m.b).toBe(2);
      expect(m.c).toBe(3);
      expect(m.d).toBe(4);
    });

    test("应该正确处理小数", () => {
      const m = Matrix.parse({ a: 1.5, b: 2.5, c: 3.5, d: 4.5 });
      expect(m.a).toBe(1.5);
      expect(m.b).toBe(2.5);
      expect(m.c).toBe(3.5);
      expect(m.d).toBe(4.5);
    });

    test("应该正确处理负数", () => {
      const m = Matrix.parse({ a: -1, b: -2, c: -3, d: -4 });
      expect(m.a).toBe(-1);
      expect(m.b).toBe(-2);
      expect(m.c).toBe(-3);
      expect(m.d).toBe(-4);
    });
  });

  describe("Matrix.parseFromArray", () => {
    test("应该从二维数组创建矩阵", () => {
      const m = Matrix.parseFromArray([
        [1, 3],
        [2, 4],
      ]);
      expect(m.a).toBe(1);
      expect(m.b).toBe(2);
      expect(m.c).toBe(3);
      expect(m.d).toBe(4);
    });

    test("应该只使用前 2x2 元素", () => {
      const m = Matrix.parseFromArray([
        [1, 3, 5],
        [2, 4, 6],
        [7, 8, 9],
      ]);
      expect(m.a).toBe(1);
      expect(m.b).toBe(2);
      expect(m.c).toBe(3);
      expect(m.d).toBe(4);
    });

    test("应该在外层数组长度不足时抛出错误", () => {
      expect(() => Matrix.parseFromArray([[1, 2]])).toThrow();
      expect(() => Matrix.parseFromArray([])).toThrow();
    });

    test("应该在内层数组长度不足时抛出错误", () => {
      expect(() => Matrix.parseFromArray([[1], [2]])).toThrow();
      expect(() => Matrix.parseFromArray([[1, 2], [3]])).toThrow();
    });

    test("应该正确处理小数", () => {
      const m = Matrix.parseFromArray([
        [1.5, 3.5],
        [2.5, 4.5],
      ]);
      expect(m.a).toBe(1.5);
      expect(m.b).toBe(2.5);
      expect(m.c).toBe(3.5);
      expect(m.d).toBe(4.5);
    });
  });

  describe("scale", () => {
    test("应能正确缩放矩阵", () => {
      const m = new Matrix(1, 2, 3, 4);
      const scaled = m.scale(2);
      expect(scaled.a).toBe(2);
      expect(scaled.b).toBe(4);
      expect(scaled.c).toBe(6);
      expect(scaled.d).toBe(8);
    });

    test("不应修改原矩阵", () => {
      const m = new Matrix(1, 2, 3, 4);
      m.scale(2);
      expect(m.a).toBe(1);
      expect(m.b).toBe(2);
      expect(m.c).toBe(3);
      expect(m.d).toBe(4);
    });

    test("应能正确处理负数缩放", () => {
      const m = new Matrix(1, 2, 3, 4);
      const scaled = m.scale(-1);
      expect(scaled.a).toBe(-1);
      expect(scaled.b).toBe(-2);
      expect(scaled.c).toBe(-3);
      expect(scaled.d).toBe(-4);
    });

    test("应能正确处理小数缩放", () => {
      const m = new Matrix(2, 4, 6, 8);
      const scaled = m.scale(0.5);
      expect(scaled.a).toBe(1);
      expect(scaled.b).toBe(2);
      expect(scaled.c).toBe(3);
      expect(scaled.d).toBe(4);
    });

    test("缩放 0 应得到零矩阵", () => {
      const m = new Matrix(1, 2, 3, 4);
      const scaled = m.scale(0);
      expect(scaled.a).toBe(0);
      expect(scaled.b).toBe(0);
      expect(scaled.c).toBe(0);
      expect(scaled.d).toBe(0);
    });

    test("单位矩阵缩放应得到对角矩阵", () => {
      const identity = Matrix.identity();
      const scaled = identity.scale(5);
      expect(scaled.a).toBe(5);
      expect(scaled.b).toBe(0);
      expect(scaled.c).toBe(0);
      expect(scaled.d).toBe(5);
    });
  });

  describe("inv", () => {
    test("应能正确计算单位矩阵的逆", () => {
      const identity = Matrix.identity();
      const inv = identity.inv();
      expect(inv.a).toBeCloseTo(1);
      expect(inv.b).toBeCloseTo(0);
      expect(inv.c).toBeCloseTo(0);
      expect(inv.d).toBeCloseTo(1);
    });

    test("应能正确计算简单矩阵的逆", () => {
      const m = new Matrix(1, 0, 0, 2);
      const inv = m.inv();
      // [[1, 0], [0, 2]] 的逆矩阵是 [[1, 0], [0, 0.5]]
      expect(inv.a).toBeCloseTo(1);
      expect(inv.b).toBeCloseTo(0);
      expect(inv.c).toBeCloseTo(0);
      expect(inv.d).toBeCloseTo(0.5);
    });

    test("应能正确计算一般矩阵的逆", () => {
      const m = new Matrix(1, 2, 3, 4);
      const inv = m.inv();
      // [[1, 3], [2, 4]] 的行列式是 1 * 4 - 2 * 3 = -2
      // 逆矩阵是 1 / -2 * [[4, -3], [-2, 1]] = [[-2, 1.5], [1, -0.5]]
      expect(inv.a).toBeCloseTo(-2);
      expect(inv.b).toBeCloseTo(1);
      expect(inv.c).toBeCloseTo(1.5);
      expect(inv.d).toBeCloseTo(-0.5);
    });

    test("矩阵与其逆矩阵相乘应得到单位矩阵", () => {
      const m = new Matrix(2, 3, 1, 4);
      const inv = m.inv();
      const result = m.mul(inv);
      expect(result.a).toBeCloseTo(1);
      expect(result.b).toBeCloseTo(0);
      expect(result.c).toBeCloseTo(0);
      expect(result.d).toBeCloseTo(1);
    });

    test("逆矩阵与原矩阵相乘应得到单位矩阵", () => {
      const m = new Matrix(2, 3, 1, 4);
      const inv = m.inv();
      const result = inv.mul(m);
      expect(result.a).toBeCloseTo(1);
      expect(result.b).toBeCloseTo(0);
      expect(result.c).toBeCloseTo(0);
      expect(result.d).toBeCloseTo(1);
    });

    test("不可逆矩阵应抛出错误", () => {
      // 行列式为0的矩阵
      const m = new Matrix(1, 2, 2, 4);
      expect(() => m.inv()).toThrow();
    });

    test("零矩阵应抛出错误", () => {
      const m = new Matrix(0, 0, 0, 0);
      expect(() => m.inv()).toThrow();
    });

    test("不应修改原矩阵", () => {
      const m = new Matrix(1, 2, 3, 4);
      m.inv();
      expect(m.a).toBe(1);
      expect(m.b).toBe(2);
      expect(m.c).toBe(3);
      expect(m.d).toBe(4);
    });

    test("旋转矩阵的逆应该是反向旋转", () => {
      const rotate90 = new Matrix(0, 1, -1, 0);
      const inv = rotate90.inv();
      // 逆矩阵应该是 -90 度旋转，即 [[0, 1], [-1, 0]]
      expect(inv.a).toBeCloseTo(0);
      expect(inv.b).toBeCloseTo(-1);
      expect(inv.c).toBeCloseTo(1);
      expect(inv.d).toBeCloseTo(0);
    });

    test("缩放矩阵的逆应该是倒数缩放", () => {
      const scale = new Matrix(2, 0, 0, 3);
      const inv = scale.inv();
      expect(inv.a).toBeCloseTo(0.5);
      expect(inv.b).toBeCloseTo(0);
      expect(inv.c).toBeCloseTo(0);
      expect(inv.d).toBeCloseTo(1 / 3);
    });

    test("逆矩阵的逆应该等于原矩阵", () => {
      const m = new Matrix(2, 3, 1, 4);
      const inv = m.inv();
      const invInv = inv.inv();
      expect(invInv.a).toBeCloseTo(m.a);
      expect(invInv.b).toBeCloseTo(m.b);
      expect(invInv.c).toBeCloseTo(m.c);
      expect(invInv.d).toBeCloseTo(m.d);
    });

    test("应能正确处理负数矩阵", () => {
      const m = new Matrix(-1, -2, -3, -4);
      const inv = m.inv();
      const result = m.mul(inv);
      expect(result.a).toBeCloseTo(1);
      expect(result.b).toBeCloseTo(0);
      expect(result.c).toBeCloseTo(0);
      expect(result.d).toBeCloseTo(1);
    });
  });

  describe("rotate", () => {
    test("应能正确旋转矩阵 0 度", () => {
      const m = Matrix.identity();
      const rotated = m.rotate(0);
      expect(rotated.a).toBeCloseTo(1);
      expect(rotated.b).toBeCloseTo(0);
      expect(rotated.c).toBeCloseTo(0);
      expect(rotated.d).toBeCloseTo(1);
    });

    test("应能正确旋转矩阵 30 度", () => {
      const m = Matrix.identity();
      const rotated = m.rotate(Math.PI / 6);
      expect(rotated.a).toBeCloseTo(Math.sqrt(3) / 2);
      expect(rotated.b).toBeCloseTo(0.5);
      expect(rotated.c).toBeCloseTo(-0.5);
      expect(rotated.d).toBeCloseTo(Math.sqrt(3) / 2);
    });

    test("应能正确旋转矩阵 45 度", () => {
      const m = Matrix.identity();
      const rotated = m.rotate(Math.PI / 4);
      expect(rotated.a).toBeCloseTo(1 / Math.sqrt(2));
      expect(rotated.b).toBeCloseTo(1 / Math.sqrt(2));
      expect(rotated.c).toBeCloseTo(-1 / Math.sqrt(2));
      expect(rotated.d).toBeCloseTo(1 / Math.sqrt(2));
    });

    test("应能正确旋转矩阵 90 度", () => {
      const m = Matrix.identity();
      const rotated = m.rotate(Math.PI / 2);
      expect(rotated.a).toBeCloseTo(0);
      expect(rotated.b).toBeCloseTo(1);
      expect(rotated.c).toBeCloseTo(-1);
      expect(rotated.d).toBeCloseTo(0);
    });

    test("应能正确旋转矩阵 180 度", () => {
      const m = Matrix.identity();
      const rotated = m.rotate(Math.PI);
      expect(rotated.a).toBeCloseTo(-1);
      expect(rotated.b).toBeCloseTo(0);
      expect(rotated.c).toBeCloseTo(0);
      expect(rotated.d).toBeCloseTo(-1);
    });

    test("应能正确旋转矩阵 270 度", () => {
      const m = Matrix.identity();
      const rotated = m.rotate((3 / 2) * Math.PI);
      expect(rotated.a).toBeCloseTo(0);
      expect(rotated.b).toBeCloseTo(-1);
      expect(rotated.c).toBeCloseTo(1);
      expect(rotated.d).toBeCloseTo(0);
    });

    test("应能正确旋转矩阵 360 度", () => {
      const m = Matrix.identity();
      const rotated = m.rotate(2 * Math.PI);
      expect(rotated.a).toBeCloseTo(1);
      expect(rotated.b).toBeCloseTo(0);
      expect(rotated.c).toBeCloseTo(0);
      expect(rotated.d).toBeCloseTo(1);
    });

    test("不应修改原矩阵", () => {
      const m = new Matrix(1, 2, 3, 4);
      m.rotate(Math.PI / 4);
      expect(m.a).toBe(1);
      expect(m.b).toBe(2);
      expect(m.c).toBe(3);
      expect(m.d).toBe(4);
    });

    test("应能正确处理负角度旋转", () => {
      const m = Matrix.identity();
      const rotated = m.rotate(-Math.PI / 2);
      expect(rotated.a).toBeCloseTo(0);
      expect(rotated.b).toBeCloseTo(-1);
      expect(rotated.c).toBeCloseTo(1);
      expect(rotated.d).toBeCloseTo(0);
    });

    test("应能正确处理非单位矩阵的旋转", () => {
      const m = new Matrix(2, 0, 0, 2); // 缩放2倍
      const rotated = m.rotate(Math.PI / 2);
      // [[2, 0], [0, 2]] * [[0, -1], [1, 0]] = [[0, -2], [2, 0]]
      expect(rotated.a).toBeCloseTo(0);
      expect(rotated.b).toBeCloseTo(2);
      expect(rotated.c).toBeCloseTo(-2);
      expect(rotated.d).toBeCloseTo(0);
    });
  });

  describe("applyToPoint", () => {
    test("应能正确将矩阵应用到点上", () => {
      const m = new Matrix(2, 0, 0, 3);
      const p = new Point(1, 2);
      const result = m.applyToPoint(p);
      // [[2, 0], [0, 3]] * [1, 2] = [2 * 1 + 0 * 2, 0 * 1 + 3 * 2] = [2, 6]
      expect(result.x).toBe(2);
      expect(result.y).toBe(6);
    });

    test("单位矩阵应用后点不变", () => {
      const identity = Matrix.identity();
      const p = new Point(5, 7);
      const result = identity.applyToPoint(p);
      expect(result.x).toBe(5);
      expect(result.y).toBe(7);
    });

    test("应能正确处理旋转矩阵", () => {
      // 90度旋转矩阵: [[0, -1], [1, 0]]
      const m = new Matrix(0, 1, -1, 0);
      const p = new Point(1, 0);
      const result = m.applyToPoint(p);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    test("应修改原始点", () => {
      const m = new Matrix(2, 0, 0, 3);
      const p = new Point(1, 2);
      m.applyToPoint(p);
      expect(p.x).toBe(2);
      expect(p.y).toBe(6);
    });
  });
});

describe("Matrix and Point", () => {
  describe("applyTransform", () => {
    test("应能正确应用矩阵变换", () => {
      const p = new Point(1, 2);
      const m = new Matrix(2, 0, 0, 3);
      const result = p.applyTransform(m);
      // [[2, 0], [0, 3]] * [1, 2] = [2 * 1 + 0 * 2, 0 * 1 + 3 * 2] = [2, 6]
      expect(result.x).toBe(2);
      expect(result.y).toBe(6);
    });

    test("单位矩阵应用后点不变", () => {
      const p = new Point(5, 7);
      const identity = Matrix.identity();
      const result = p.applyTransform(identity);
      expect(result.x).toBe(5);
      expect(result.y).toBe(7);
    });

    test("应能正确处理缩放变换", () => {
      const p = new Point(3, 4);
      const scale = Matrix.identity().scale(2);
      p.applyTransform(scale);
      expect(p.x).toBe(6);
      expect(p.y).toBe(8);
    });

    test("应能正确处理旋转变换", () => {
      // 90 度旋转矩阵: [[0, -1], [1, 0]]
      const rotate90 = new Matrix(0, 1, -1, 0);
      const p = new Point(1, 0);
      p.applyTransform(rotate90);
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(1);
    });

    test("应能正确处理复合变换", () => {
      const p = new Point(1, 1);
      const m1 = new Matrix(2, 0, 0, 2); // 缩放 2 倍
      const m2 = new Matrix(1, 0, 1, 1); // 剪切变换

      // 先缩放
      p.applyTransform(m1);
      expect(p.x).toBe(2);
      expect(p.y).toBe(2);

      // 再剪切
      p.applyTransform(m2);
      expect(p.x).toBe(4); // 2 * 1 + 2 * 1
      expect(p.y).toBe(2); // 2 * 0 + 2 * 1
    });

    test("应能正确处理负数", () => {
      const p = new Point(2, 3);
      const m = new Matrix(-1, 0, 0, -1);
      p.applyTransform(m);
      expect(p.x).toBe(-2);
      expect(p.y).toBe(-3);
    });
  });

  describe("Point.mulMatrix", () => {
    test("不应修改原始点", () => {
      const p = new Point(1, 2);
      const m = new Matrix(2, 0, 0, 3);
      Point.mulMatrix(m, p);
      expect(p.x).toBe(1);
      expect(p.y).toBe(2);
    });
  });
});
