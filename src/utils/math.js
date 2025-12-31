/**
 * @file 二维数学模块
 * @description
 * 提供二维平面上点和矩阵的表示与操作功能，包括:
 * - 二维点 Point
 * - 2x2 矩阵 Matrix
 * @module math
 * @author Zhou Chenyu
 */

/**
 * 二维点
 * @class
 * @description 表示二维平面上的一个点，包含 X 和 Y 坐标，支持矩阵变换
 * @author Zhou Chenyu
 */
class Point {
  /**
   * 点的横坐标
   * @type {number}
   */
  x;

  /**
   * 点的纵坐标
   * @type {number}
   */
  y;

  /**
   * @constructor
   * @param {number} x - 点的横坐标
   * @param {number} y - 点的纵坐标
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * 将此对象序列化为普通 JSON 对象
   * @returns {{x: number, y: number}} 包含 x 和 y 坐标的对象
   * @example
   * const point = new Point(10, 20);
   * console.log(point.serialize()); // { x: 10, y: 20 }
   */
  serialize() {
    return { x: this.x, y: this.y };
  }

  /**
   * 将此对象序列化为数组对象
   * @returns {number[]} 包含 x 和 y 坐标的数组
   * @example
   * const point = new Point(10, 20);
   * console.log(point.serializeToArray()); // [10, 20]
   */
  serializeToArray() {
    return [this.x, this.y];
  }

  /**
   * 将此对象序列化为字符串
   * @returns {String}
   * @example
   * const point = new Point(10, 20);
   * console.log(point.toString()); // Point(10, 20)
   */
  toString() {
    return `Point(${this.x}, ${this.y})`;
  }

  /**
   * 将序列化的对象转化为 Point 实例
   * @param {{x: number, y: number}} point - 包含 x 和 y 坐标的对象
   * @returns {Point} Point 实例
   * @static
   * @example
   * const point = Point.parse({ x: 10, y: 20 }); // Point(10, 20)
   */
  static parse(point) {
    return new Point(point.x, point.y);
  }

  /**
   * 将序列化成数组的对象转化为 Point 实例
   * @param {number[]} arr - 一个长度为 2 的数组，分别表示其横坐标和纵坐标
   * @returns {Point} Point 实例
   * @static
   * @throws {RangeError} 当 `arr` 的长度小于 2 时
   * @example
   * const point = Point.parseFromArray([10, 20]); // Point(10, 20)
   */
  static parseFromArray(arr) {
    if (arr.length < 2) {
      throw new RangeError("Array must have at least 2 elements");
    }
    return new Point(arr[0], arr[1]);
  }

  /**
   * 应用变换矩阵
   * @description 此方法会修改当前点的坐标
   * @param {Matrix} matrix - 要应用的变换矩阵
   * @returns {Point} 返回自己以支持链式调用
   * @example
   * const point = new Point(1, 0);
   * const rotationMatrix = new Matrix([[0, -1], [1, 0]]); // 90度旋转
   * point.applyTransform(rotationMatrix); // point 现在是 (0, 1)
   */
  applyTransform(matrix) {
    let p = Point.mulMatrix(matrix, this);
    this.x = p.x;
    this.y = p.y;
    return this;
  }

  /**
   * 将矩阵与点相乘
   * @description 执行矩阵-向量乘法，返回新的 Point 实例而非修改传入点
   * @param {Matrix} m - 2x2 变换矩阵
   * @param {Point} p - 要变换的点
   * @returns {Point} 变换后的新点
   * @static
   * @example
   * const point = new Point(1, 0);
   * const rotationMatrix = new Matrix([[0, -1], [1, 0]]); // 90度旋转
   * console.log(Point.mulMatrix(rotationMatrix, point).toString()); // point 仍是 (1, 0)，但输出 Point(0, 1)
   */
  static mulMatrix(m, p) {
    return new Point(m.a * p.x + m.c * p.y, m.b * p.x + m.d * p.y);
  }

  /**
   * 判断两点是否在精度范围内相等
   * @param {Point} a - 第一个点
   * @param {Point} b - 第二个点
   * @param {number} [eps = 1e-10] - 允许的误差范围
   * @returns {boolean} 如果两个点在误差范围内相等则返回 true，否则返回 false
   * @static
   * @example
   * const p1 = new Point(1, 2);
   * const p2 = new Point(1.05, 2);
   * console.log(Point.nearlyEq(p1, p1)); // true
   * console.log(Point.nearlyEq(p1, p2, 0.01)); // false
   * console.log(Point.nearlyEq(p1, p2, 0.1)); // true
   */
  static nearlyEq(a, b, eps = 1e-10) {
    return (
      Math.abs(a.x - b.x) <= Math.abs(eps) &&
      Math.abs(a.y - b.y) <= Math.abs(eps)
    );
  }

  /**
   * 计算两点之间的距离
   * @param {Point} a - 第一个点
   * @param {Point} b - 第二个点
   * @returns {number} 两点之间的距离
   * @static
   * @example
   * const p1 = new Point(0, 0);
   * const p2 = new Point(3, 4);
   * console.log(Point.distanceTo(p1, p2)); // 5
   */
  static distanceTo(a, b) {
    return Math.sqrt(Point.distanceSq(a, b));
  }

  /**
   * 计算两点之间距离的平方
   * @param {Point} a - 第一个点
   * @param {Point} b - 第二个点
   * @returns {number} 两点之间距离的平方
   * @static
   * @example
   * const p1 = new Point(1, 0)
   * const p2 = new Point(3, 4)
   * console.log(Point.distanceSq(p1, p2)); // 20
   */
  static distanceSq(a, b) {
    return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
  }

  /**
   * 克隆该点
   * @returns {Point} Point 实例
   * @example
   * let p1 = new Point(1, 0);
   * let p2 = p1.clonePoint();
   * p2.x = 0;
   * console.log(p1.toString()); // Point(1, 0)
   * console.log(p2.toString()); // Point(0, 0)
   */
  clonePoint() {
    return new Point(this.x, this.y);
  }

  /**
   * 两点相加
   * @param {Point} other - 另一个点
   * @returns {Point} 两点相加的结果
   * @example
   * const p1 = new Point(5, 10);
   * const p2 = new Point(-2, -3);
   * console.log(p1.add(p2).toString()) // Point(3, 7)
   */
  add(other) {
    return new Point(this.x + other.x, this.y + other.y);
  }

  /**
   * 两点相减
   * @param {Point} other - 另一个点，被减点
   * @returns {Point} 两点相减的结果
   * @example
   * const p1 = new Point(5, 10);
   * const p2 = new Point(-2, -3);
   * console.log(p1.sub(p2).toString()) // Point(7, 13)
   */
  sub(other) {
    return new Point(this.x - other.x, this.y - other.y);
  }

  /**
   * 两点相点乘
   * @param {Point} other - 另一个点
   * @returns {number} 两点相点乘的结果
   * @example
   * const p1 = new Point(5, 10);
   * const p2 = new Point(-2, -3);
   * console.log(p1.dotMul(p2)) // -40
   */
  dotMul(other) {
    return this.x * other.x + this.y * other.y;
  }
}

/**
 * 2x2 矩阵
 * @class
 * @description 表示一个二维矩阵 [[a, c], [b, d]]
 * @author Zhou Chenyu
 */
class Matrix {
  /**
   * 矩阵 [[**a**, c], [b, d]] 中的 a
   * @type {number}
   */
  a;

  /**
   * 矩阵 [[a, c], [**b**, d]] 中的 b
   * @type {number}
   */
  b;

  /**
   * 矩阵 [[a, **c**], [b, d]] 中的 c
   * @type {number}
   */
  c;

  /**
   * 矩阵 [[a, c], [b, **d**]] 中的 d
   * @type {number}
   */
  d;

  /**
   * 构造矩阵 [[a, c], [b, d]]
   * @constructor
   * @param {number} a - 矩阵 [[**a**, c], [b, d]] 中的 a
   * @param {number} b - 矩阵 [[a, c], [**b**, d]] 中的 b
   * @param {number} c - 矩阵 [[a, **c**], [b, d]] 中的 c
   * @param {number} d - 矩阵 [[a, c], [b, **d**]] 中的 d
   */
  constructor(a, b, c, d) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }

  /**
   * 构建单位矩阵
   * @returns {Matrix} Matrix[[1, 0], [0, 1]]
   * @static
   * @example
   * const mat = Matrix.identity();
   * console.log(mat.toString()); // Matrix[[1, 0], [0, 1]]
   */
  static identity() {
    return new Matrix(1, 0, 0, 1);
  }

  /**
   * 将此对象序列化为普通 JSON 对象
   * @returns {{x: number, y: number}} 包含 x 和 y 坐标的对象
   * @example
   * const mat = new Matrix(10, 30, 20, 40);
   * console.log(mat.serialize()); // { a: 10, b: 20, c: 30, d: 40 }
   */
  serialize() {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  /**
   * 将此对象序列化为数组对象
   * @returns {number[]} 包含 x 和 y 坐标的数组
   * @example
   * const mat = new Matrix(10, 30, 20, 40);
   * console.log(mat.serializeToArray()); // [[10, 20], [30, 40]]
   */
  serializeToArray() {
    return [
      [this.a, this.c],
      [this.b, this.d],
    ];
  }

  /**
   * 将此对象序列化为字符串
   * @returns {String}
   * @example
   * const mat = new Matrix(10, 30, 20, 40);
   * console.log(mat.toString()); // Matrix[[10, 20], [30, 40]]
   */
  toString() {
    return `Matrix[[${this.a}, ${this.c}], [${this.b}, ${this.d}]]`;
  }

  /**
   * 将序列化的对象转化为 Matrix 实例
   * @param {{a: number, b: number, c: number, d: number}} matrix - 包含 a, b, c, d 的对象
   * @returns {Matrix} Matrix 实例
   * @static
   * @example
   * const matrix = Matrix.parse({ a: 10, b: 30, c: 20, d: 40 }); // Matrix[[10, 20], [30, 40]]
   */
  static parse(matrix) {
    return new Matrix(matrix.a, matrix.b, matrix.c, matrix.d);
  }

  /**
   * 将序列化成数组的对象转化为 Matrix 实例
   * @param {number[][]} arr - 一个 2x2 的二维数组
   * @returns {Matrix} Matrix 实例
   * @static
   * @throws {RangeError} 当 `arr` 的大小小于 2x2 时
   * @example
   * const matrix = Matrix.parse([[10, 20], [30, 40]]); // Matrix[[10, 20], [30, 40]]
   */
  static parseFromArray(arr) {
    if (arr.length < 2) {
      throw new RangeError("Array must have at least 2 elements");
    } else if (arr[0].length < 2 || arr[1].length < 2) {
      throw new RangeError("Element array must have at least 2 elements");
    }
    return new Matrix(arr[0][0], arr[1][0], arr[0][1], arr[1][1]);
  }

  /**
   * 克隆该矩阵
   * @returns {Matrix} Matrix 实例
   * @example
   * let m1 = new Matrix(1, 0, 0, 1);
   * let m2 = m1.clonePoint();
   * m1.a = 0;
   * console.log(m1.toString()); // Matrix[[0, 0], [0, 1]]
   * console.log(m2.toString()); // Matrix[[1, 0], [0, 1]]
   */
  cloneMatrix() {
    return new Matrix(this.a, this.b, this.c, this.d);
  }

  /**
   * 获取矩阵内某元素
   * @param {0 | 1} x
   * @param {0 | 1} y
   * @returns {number}
   * @throws {RangeError} - 当 `x` 或 `y` 不为 0 或 1 时
   * @example
   * const matrix = new Matrix(10, -2, 4.5, 2);
   * console.log(matrix.get(0, 0)); // 10
   * console.log(matrix.get(1, 0)); // -2
   * console.log(matrix.get(0, 1)); // 4.5
   * console.log(matrix.get(1, 1)); // 2
   */
  get(x, y) {
    if (x == 0 && y == 0) {
      return this.a;
    } else if (x == 0 && y == 1) {
      return this.c;
    } else if (x == 1 && y == 0) {
      return this.b;
    } else if (x == 1 && y == 1) {
      return this.d;
    }
    throw new RangeError("x or y must be 0 or 1");
  }

  /**
   * 获取矩阵内某元素
   * @param {number[]} arr
   * @returns {number}
   * @throws {RangeError} - 当 `arr` 长度小于 2，或 `x` 或 `y` 不为 0 或 1 时
   * @example
   * const matrix = new Matrix(10, -2, 4.5, 2);
   * console.log(matrix.getFromArr([0, 0])); // 10
   * console.log(matrix.getFromArr([1, 0])); // -2
   * console.log(matrix.getFromArr([0, 1])); // 4.5
   * console.log(matrix.getFromArr([1, 1])); // 2
   */
  getFromArr(arr) {
    if (arr.length < 2) {
      throw new RangeError("Array must have at least 2 elements");
    }
    try {
      return this.get(arr[0], arr[1]);
    } catch (err) {
      throw err;
    }
  }

  /**
   * 将该变换矩阵应用到某点
   * @description 此方法会修改传入点的坐标
   * @param {Point} point - 要应用该矩阵的点
   * @returns {Point} 返回传入点以支持链式调用
   * @example
   * const m = new Matrix(2, 0, 0, 3);
   * const p = new Point(1, 2);
   * const r = m.applyToPoint(p);
   * console.log(p.toString()); // Point(2, 6)
   * console.log(r.toString()); // Point(2, 6)
   */
  applyToPoint(point) {
    return point.applyTransform(this);
  }

  /**
   * 两矩阵相加
   * @param {Matrix} other - 另一个矩阵
   * @returns {Matrix} 两矩阵相加的结果
   * @example
   * const m1 = new Matrix(5, 10, 0, 1);
   * const m2 = new Matrix(-2, -3, 9, -2);
   * console.log(p1.add(p2).toString()) // Matrix[[3, 9], [7, -1]]
   */
  add(other) {
    return new Matrix(
      this.a + other.a,
      this.b + other.b,
      this.c + other.c,
      this.d + other.d
    );
  }

  /**
   * 两矩阵相减
   * @param {Matrix} other - 另一个矩阵，被减矩阵
   * @returns {Matrix} 两矩阵相减的结果
   * @example
   * const m1 = new Matrix(5, 10, 0, 1);
   * const m2 = new Matrix(-2, -3, 9, -2);
   * console.log(p1.add(p2).toString()) // Matrix[[7, -9], [13, 3]]
   */
  sub(other) {
    return new Matrix(
      this.a - other.a,
      this.b - other.b,
      this.c - other.c,
      this.d - other.d
    );
  }

  /**
   * 两矩阵相乘
   * @param {Matrix} other - 另一个矩阵
   * @returns {Matrix} 两矩阵相乘的结果
   * @example
   * const m1 = new Matrix(1, 2, 3, 4);
   * const m2 = new Matrix(5, 6, 7, 8);
   * console.log(p1.mul(p2).toString()) // Matrix[[23, 31], [34, 46]]
   */
  mul(other) {
    return new Matrix(
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d
    );
  }

  /**
   * 矩阵缩放（数乘）
   * @param {number} scale - 要放大的倍数
   * @returns {Matrix} 矩阵缩放的结果
   * @example
   * const m1 = new Matrix(1, 2, 3, 4);
   * console.log(p1.scale(2).toString()) // Matrix[[2, 6], [4, 8]]
   */
  scale(scale) {
    return new Matrix(
      this.a * scale,
      this.b * scale,
      this.c * scale,
      this.d * scale
    );
  }

  /**
   * 矩阵旋转
   * @param {number} radian - 要旋转的角（弧度制）
   * @returns {Matrix} 矩阵旋转的结果
   * @example
   * const m1 = Matrix.identity();
   * console.log(p1.rotate(Math.PI / 2).toString()) // Matrix[[0, -1], [1, 0]]
   */
  rotate(radian) {
    return this.mul(
      new Matrix(
        Math.cos(radian),
        Math.sin(radian),
        -Math.sin(radian),
        Math.cos(radian)
      )
    );
  }

  /**
   * 计算该矩阵的行列式
   * @returns {number} 该矩阵的行列式
   * @example
   * const mat = new Matrix(1, 2, 3, 4);
   * console.log(mat.det()); // -2
   */
  det() {
    return this.a * this.d - this.b * this.c;
  }

  /**
   * 计算该矩阵的逆矩阵
   * @throws {Error} 当该矩阵不可逆时（行列式为 0）
   * @returns {Matrix} 该矩阵的逆矩阵
   * @example
   * const mat = new Matrix(1, 2, 3, 4);
   * console.log(mat.inv().toString()); // Matrix[[-2, 1.5], [1, -0.5]]
   */
  inv() {
    let det = this.det();
    if (Math.abs(det) < 0.000001) {
      throw new Error("Matrix is not invertible (determinant is zero)");
    }
    return new Matrix(this.d, -this.b, -this.c, this.a).scale(1.0 / det);
  }

  /**
   * 判断两矩阵是否在精度范围内相等
   * @param {Matrix} a - 第一个矩阵
   * @param {Matrix} b - 第二个矩阵
   * @param {number} eps - 精度，默认为 1e-10
   * @returns {boolean}
   * @example
   * const m1 = new Matrix(1, 2, 1, 2);
   * const m2 = new Matrix(1, 2, 1.05, 2);
   * console.log(Matrix.nearlyEq(m1, m1)); // true
   * console.log(Matrix.nearlyEq(m1, m2, 0.01)); // false
   * console.log(Matrix.nearlyEq(m1, m2, 0.1)); // true
   */
  static nearlyEq(a, b, eps = 1e-10) {
    return (
      Math.abs(a.a - b.a) <= Math.abs(eps) &&
      Math.abs(a.b - b.b) <= Math.abs(eps) &&
      Math.abs(a.c - b.c) <= Math.abs(eps) &&
      Math.abs(a.d - b.d) <= Math.abs(eps)
    );
  }
}

module.exports = {
  Point,
  Matrix,
};
