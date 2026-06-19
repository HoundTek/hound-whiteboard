import { Vector3D, Matrix3D } from "../math3d.js";

describe("Vector3D Class", () => {
  describe("构造函数", () => {
    test("应能正确创建点", () => {
      const p = new Vector3D(3, 4, 5);
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
      expect(p.z).toBe(5);
    });

    test("应该接受负数", () => {
      const p = new Vector3D(-5, -10, -15);
      expect(p.x).toBe(-5);
      expect(p.y).toBe(-10);
      expect(p.z).toBe(-15);
    });

    test("应该接受小数", () => {
      const p = new Vector3D(3.5, 4.2, 5.1);
      expect(p.x).toBe(3.5);
      expect(p.y).toBe(4.2);
      expect(p.z).toBe(5.1);
    });
  });

  describe("serialize", () => {
    test("应能返回正确的 JSON 对象", () => {
      const p = new Vector3D(3, 4, 5);
      const json = p.serialize();
      expect(json).toEqual({ x: 3, y: 4, z: 5 });
    });

    test("应能返回独立的对象", () => {
      const p = new Vector3D(5, 10, 15);
      const json = p.serialize();
      json.x = 100;
      expect(p.x).toBe(5); // 原点不应被修改
    });
  });

  describe("serializeToArray", () => {
    test("应能返回正确的数组", () => {
      const p = new Vector3D(3, 4, 5);
      const arr = p.serializeToArray();
      expect(arr).toEqual([3, 4, 5]);
    });
  });

  describe("toString", () => {
    test("应能返回正确的字符串表示", () => {
      const p = new Vector3D(3, 4, 5);
      expect(p.toString()).toBe("Vector3D(3, 4, 5)");
    });
  });

  describe("Vector3D.parse", () => {
    test("应能从 JSON 对象创建点", () => {
      const p = Vector3D.parse({ x: 3, y: 4, z: 5 });
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
      expect(p.z).toBe(5);
    });

    test("应能从数组创建点", () => {
      const p = Vector3D.parse([3, 4, 5]);
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
      expect(p.z).toBe(5);
    });

    test("应在数组长度不足时抛出错误", () => {
      expect(() => Vector3D.parse([1, 2])).toThrow();
    });
  });

  describe("distanceTo", () => {
    test("应能正确计算距离", () => {
      const p1 = new Vector3D(0, 0, 0);
      const p2 = new Vector3D(1, 2, 2);
      expect(Vector3D.distanceTo(p1, p2)).toBe(3); // sqrt(1+4+4) = 3
    });

    test("distanceSq 应能正确计算距离的平方", () => {
      const p1 = new Vector3D(0, 0, 0);
      const p2 = new Vector3D(1, 2, 2);
      expect(Vector3D.distanceSq(p1, p2)).toBe(9);
    });
  });

  describe("nearlyEq", () => {
    test("应能正确判断两点是否在精度范围内相等", () => {
      const p1 = new Vector3D(5, 10, 15);
      const p2 = new Vector3D(5.0001, 10, 15);
      expect(Vector3D.nearlyEq(p1, p2, 0.0001)).toBe(true);
      expect(Vector3D.nearlyEq(p1, p2, 0.00005)).toBe(false);
    });
  });

  describe("clone", () => {
    test("应能创建独立的副本", () => {
      const p1 = new Vector3D(1, 2, 3);
      const p2 = p1.clone();

      expect(p2.x).toBe(1);
      expect(p2.y).toBe(2);
      expect(p2.z).toBe(3);

      p2.x = 10;
      expect(p1.x).toBe(1);
      expect(p2.x).toBe(10);
    });
  });

  describe("add", () => {
    test("应能正确计算两点之和", () => {
      const p1 = new Vector3D(1, 2, 3);
      const p2 = new Vector3D(4, 5, 6);
      const p3 = p1.add(p2);
      expect(p3.x).toBe(5);
      expect(p3.y).toBe(7);
      expect(p3.z).toBe(9);
    });
  });

  describe("sub", () => {
    test("应能正确计算两点之差", () => {
      const p1 = new Vector3D(4, 5, 6);
      const p2 = new Vector3D(1, 2, 3);
      const p3 = p1.sub(p2);
      expect(p3.x).toBe(3);
      expect(p3.y).toBe(3);
      expect(p3.z).toBe(3);
    });
  });

  describe("dotMul", () => {
    test("应能正确计算点乘", () => {
      const p1 = new Vector3D(1, 2, 3);
      const p2 = new Vector3D(4, 5, 6);
      // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
      expect(p1.dotMul(p2)).toBe(32);
    });
  });

  describe("crossMul", () => {
    test("应能正确计算叉乘", () => {
      const p1 = new Vector3D(1, 0, 0);
      const p2 = new Vector3D(0, 1, 0);
      const p3 = p1.crossMul(p2);
      // i x j = k
      expect(p3.x).toBe(0);
      expect(p3.y).toBe(0);
      expect(p3.z).toBe(1);
    });

    test("反向叉乘应得到相反向量", () => {
      const p1 = new Vector3D(1, 0, 0);
      const p2 = new Vector3D(0, 1, 0);
      const p3 = p2.crossMul(p1);
      // j x i = -k
      expect(p3.x).toBe(0);
      expect(p3.y).toBe(0);
      expect(p3.z).toBe(-1);
    });
  });
});

describe("Matrix3D Class", () => {
  describe("构造函数", () => {
    test("应能正确创建矩阵", () => {
      const m = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
      expect(m.a11).toBe(1);
      expect(m.a12).toBe(2);
      expect(m.a13).toBe(3);
      expect(m.a21).toBe(4);
      expect(m.a22).toBe(5);
      expect(m.a23).toBe(6);
      expect(m.a31).toBe(7);
      expect(m.a32).toBe(8);
      expect(m.a33).toBe(9);
    });
  });

  describe("Matrix3D.identity", () => {
    test("应能创建单位矩阵", () => {
      const m = Matrix3D.identity();
      expect(m.a11).toBe(1);
      expect(m.a12).toBe(0);
      expect(m.a13).toBe(0);
      expect(m.a22).toBe(1);
      expect(m.a33).toBe(1);
    });
  });

  describe("get", () => {
    test("应能正确获取矩阵内元素", () => {
      const m = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
      expect(m.get(0, 0)).toBe(1);
      expect(m.get(0, 1)).toBe(2);
      expect(m.get(1, 0)).toBe(4);
      expect(m.get(2, 2)).toBe(9);
    });

    test("越界访问应抛出错误", () => {
      const m = Matrix3D.identity();
      expect(() => m.get(3, 0)).toThrow();
    });
  });

  describe("getFromArr", () => {
    test("应能正确获取矩阵内元素", () => {
      const m = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
      expect(m.getFromArr([0, 0])).toBe(1);
      expect(m.getFromArr([2, 2])).toBe(9);
    });
  });

  describe("clone", () => {
    test("应该创建独立的副本", () => {
      const m1 = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const m2 = m1.clone();

      expect(m2.a11).toBe(1);
      m2.a11 = 10;
      expect(m1.a11).toBe(1);
      expect(m2.a11).toBe(10);
    });
  });

  describe("det", () => {
    test("应能正确计算单位矩阵的行列式", () => {
      const m = Matrix3D.identity();
      expect(m.det()).toBe(1);
    });

    test("应能正确计算一般矩阵的行列式", () => {
      // | 1 2 3 |
      // | 0 1 4 |
      // | 5 6 0 |
      // = 1(0-24) - 2(0-20) + 3(0-5)
      // = -24 + 40 - 15 = 1
      const m = new Matrix3D(1, 2, 3, 0, 1, 4, 5, 6, 0);
      expect(m.det()).toBe(1);
    });
  });

  describe("add", () => {
    test("应能正确计算矩阵之和", () => {
      const m1 = Matrix3D.identity();
      const m2 = Matrix3D.identity();
      const m3 = m1.add(m2);
      expect(m3.a11).toBe(2);
      expect(m3.a22).toBe(2);
      expect(m3.a33).toBe(2);
    });
  });

  describe("sub", () => {
    test("应能正确计算矩阵之差", () => {
      const m1 = new Matrix3D(2, 2, 2, 2, 2, 2, 2, 2, 2);
      const m2 = new Matrix3D(1, 1, 1, 1, 1, 1, 1, 1, 1);
      const m3 = m1.sub(m2);
      expect(m3.a11).toBe(1);
      expect(m3.a33).toBe(1);
    });
  });

  describe("mul", () => {
    test("应能正确计算矩阵乘法", () => {
      const m1 = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const m2 = Matrix3D.identity();
      const m3 = m1.mul(m2);
      expect(m3.serialize()).toEqual(m1.serialize());
    });
  });

  describe("scale", () => {
    test("应能正确缩放矩阵", () => {
      const m = Matrix3D.identity();
      const scaled = m.scale(2);
      expect(scaled.a11).toBe(2);
      expect(scaled.a22).toBe(2);
      expect(scaled.a33).toBe(2);
      expect(scaled.a12).toBe(0);
    });
  });

  describe("inv", () => {
    test("应能正确计算单位矩阵的逆", () => {
      const identity = Matrix3D.identity();
      const inv = identity.inv();
      expect(inv.a11).toBeCloseTo(1);
      expect(inv.a22).toBeCloseTo(1);
      expect(inv.a33).toBeCloseTo(1);
    });

    test("矩阵与其逆矩阵相乘应得到单位矩阵", () => {
      // | 1 2 3 |
      // | 0 1 4 |
      // | 5 6 0 |
      const m = new Matrix3D(1, 2, 3, 0, 1, 4, 5, 6, 0);
      const inv = m.inv();
      const result = m.mul(inv);
      
      expect(result.a11).toBeCloseTo(1);
      expect(result.a12).toBeCloseTo(0);
      expect(result.a13).toBeCloseTo(0);
      expect(result.a22).toBeCloseTo(1);
      expect(result.a33).toBeCloseTo(1);
    });

    test("不可逆矩阵应抛出错误", () => {
      const m = new Matrix3D(0, 0, 0, 0, 0, 0, 0, 0, 0);
      expect(() => m.inv()).toThrow();
    });
  });

  describe("nearlyEq", () => {
    test("应能正确判断两矩阵是否在精度范围内相等", () => {
      const m1 = Matrix3D.identity();
      const m2 = Matrix3D.identity();
      m2.a11 = 1.0001;
      expect(Matrix3D.nearlyEq(m1, m2, 0.0001)).toBe(true);
      expect(Matrix3D.nearlyEq(m1, m2, 0.00005)).toBe(false);
    });
  });

  describe("toString", () => {
    test("应能返回正确的字符串表示", () => {
      const m = Matrix3D.identity();
      expect(m.toString()).toContain("Matrix3D[[1, 0, 0], [0, 1, 0], [0, 0, 1]]");
    });
  });

  describe("serialize", () => {
    test("应该返回正确的 JSON 对象", () => {
      const m = Matrix3D.identity();
      const json = m.serialize();
      expect(json.a11).toBe(1);
      expect(json.a12).toBe(0);
    });
  });

  describe("serializeToArray", () => {
    test("应该返回正确的二维数组", () => {
      const m = Matrix3D.identity();
      const arr = m.serializeToArray();
      expect(arr).toEqual([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]);
    });
  });

  describe("Matrix3D.parse", () => {
    test("应该从 JSON 对象创建矩阵", () => {
      const m = Matrix3D.parse({
        a11: 1, a12: 2, a13: 3,
        a21: 4, a22: 5, a23: 6,
        a31: 7, a32: 8, a33: 9
      });
      expect(m.a11).toBe(1);
      expect(m.a33).toBe(9);
    });

    test("应该从二维数组创建矩阵", () => {
      const m = Matrix3D.parse([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9]
      ]);
      expect(m.a11).toBe(1);
      expect(m.a33).toBe(9);
    });

    test("应在数组不合法时抛出错误", () => {
      expect(() => Matrix3D.parse([])).toThrow();
      expect(() => Matrix3D.parse([[1], [2], [3]])).toThrow();
    });
  });

  describe("applyToVector", () => {
    test("应能正确将矩阵应用到点上", () => {
      const m = Matrix3D.identity();
      const p = new Vector3D(1, 2, 3);
      const result = m.applyToVector(p);
      expect(result.x).toBe(1);
      expect(result.y).toBe(2);
      expect(result.z).toBe(3);
    });

    test("应修改原始点", () => {
      const m = Matrix3D.identity().scale(2);
      const p = new Vector3D(1, 1, 1);
      m.applyToVector(p);
      expect(p.x).toBe(2);
      expect(p.y).toBe(2);
      expect(p.z).toBe(2);
    });
  });
});

describe("Matrix3D and Vector3D", () => {
  describe("applyTransform", () => {
    test("应能正确应用矩阵变换", () => {
      const p = new Vector3D(1, 2, 3);
      const m = Matrix3D.identity().scale(2);
      p.applyTransform(m);
      expect(p.x).toBe(2);
      expect(p.y).toBe(4);
      expect(p.z).toBe(6);
    });
  });

  describe("Vector3D.mulMatrix", () => {
    test("不应修改原始点", () => {
      const p = new Vector3D(1, 2, 3);
      const m = Matrix3D.identity().scale(2);
      const p2 = Vector3D.mulMatrix(m, p);
      
      expect(p.x).toBe(1);
      expect(p2.x).toBe(2);
    });
  });
});
