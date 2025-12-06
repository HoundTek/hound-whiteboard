const { Point } = require("../src/rust-bindings/point");

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
      expect(p1.distanceTo(p2)).toBe(5);
    });

    test("应能计算到自己的距离为 0", () => {
      const p1 = new Point(5, 5);
      const p2 = new Point(5, 5);
      expect(p1.distanceTo(p2)).toBe(0);
    });

    test("应能正确处理负坐标", () => {
      const p1 = new Point(-3, -4);
      const p2 = new Point(0, 0);
      expect(p1.distanceTo(p2)).toBe(5);
    });

    test("distanceSq 应能正确计算距离的平方", () => {
      const p1 = new Point(0, 1);
      const p2 = new Point(3, 4);
      expect(p1.distanceSq(p2)).toBe(18);
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
      expect(p1.nearlyEq(p2, 0.0001)).toBe(true);
      expect(p1.nearlyEq(p2, 0.0002)).toBe(true);
      expect(p1.nearlyEq(p2, 0.00005)).toBe(false);
    });

    test("应能正确处理精度为零的情况", () => {
      const p1 = new Point(5, 10);
      const p2 = new Point(5, 10);
      const p3 = new Point(5.00001, 10);
      expect(p1).toEqual(p2);
      expect(p1.nearlyEq(p2, 0)).toBe(true);
      expect(p1.nearlyEq(p3, 0)).toBe(false);
    });

    test("应能正确处理精度为负的情况", () => {
      const p1 = new Point(5, 10);
      const p2 = new Point(5.0001, 10);
      expect(p1.nearlyEq(p2, -0.0001)).toBe(true);
      expect(p1.nearlyEq(p2, -0.0002)).toBe(true);
      expect(p1.nearlyEq(p2, -0.00005)).toBe(false);
    })
  })

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
