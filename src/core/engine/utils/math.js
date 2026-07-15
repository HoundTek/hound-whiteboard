/**
 * @file 二维数学模块
 * @description
 * 提供二维平面上点和矩阵的表示与操作功能，包括:
 * - 二维点 Vector
 * - 2x2 矩阵 Matrix
 * @module core/engine/utils/math
 * @author Zhou Chenyu
 */

/**
 * 二维向量
 * @class
 * @description 表示二维的向量，包含 X 和 Y 坐标，支持矩阵变换
 * @author Zhou Chenyu
 */
class Vector {
  /**
   * 向量的横坐标
   * @type {number}
   */
  x;

  /**
   * 向量的纵坐标
   * @type {number}
   */
  y;

  /**
   * @constructor
   * @param {number} x - 向量的横坐标
   * @param {number} y - 向量的纵坐标
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * 将此对象序列化为普通 JSON 对象
   * @returns {{x: number, y: number}} 包含 x 和 y 坐标的对象
   * @example
   * const vec = new Vector(10, 20);
   * console.log(vec.serialize()); // { x: 10, y: 20 }
   */
  serialize() {
    return { x: this.x, y: this.y };
  }

  /**
   * 将此对象序列化为数组对象
   * @returns {number[]} 包含 x 和 y 坐标的数组
   * @example
   * const vec = new Vector(10, 20);
   * console.log(vec.serializeToArray()); // [10, 20]
   */
  serializeToArray() {
    return [this.x, this.y];
  }

  /**
   * 将此对象序列化为字符串
   * @returns {String}
   * @example
   * const vec = new Vector(10, 20);
   * console.log(vec.toString()); // Vector(10, 20)
   */
  toString() {
    return `Vector(${this.x}, ${this.y})`;
  }

  /**
   * 将序列化的对象转化为 Vector 实例
   * @param {{x: number, y: number}} vec - 包含 x 和 y 坐标的对象
   * @returns {Vector} Vector 实例
   * @static
   * @example
   * const vec = Vector.parse({ x: 10, y: 20 }); // Vector(10, 20)
   */
  static parse(vec) {
    if (!vec) return null;
    if (vec instanceof Vector) return vec;
    if (Array.isArray(vec)) {
      if (vec.length < 2) {
        throw new RangeError("Array must have at least 2 elements");
      }
      return new Vector(vec[0], vec[1]);
    }
    if (typeof vec.x === "number" && typeof vec.y === "number") {
      return new Vector(vec.x, vec.y);
    }
    return null;
  }

  /**
   * 应用变换矩阵
   * @description 此方法会修改当前向量
   * @param {Matrix} matrix - 要应用的变换矩阵
   * @returns {Vector} 返回自己以支持链式调用
   * @example
   * const vec = new Vector(1, 0);
   * const rotationMatrix = new Matrix([[0, -1], [1, 0]]); // 90度旋转
   * vec.applyTransform(rotationMatrix); // vec 现在是 (0, 1)
   */
  applyTransform(matrix) {
    let p = Vector.mulMatrix(matrix, this);
    this.x = p.x;
    this.y = p.y;
    return this;
  }

  /**
   * 将矩阵与向量相乘
   * @description 执行矩阵-向量乘法，返回新的 Vector 实例而非修改传入向量
   * @param {Matrix} m - 2x2 变换矩阵
   * @param {Vector} v - 要变换的向量
   * @returns {Vector} 变换后的新向量
   * @static
   * @example
   * const vec = new Vector(1, 0);
   * const rotationMatrix = new Matrix([[0, -1], [1, 0]]); // 90度旋转
   * console.log(Vector.mulMatrix(rotationMatrix, vec).toString()); // vec 仍是 (1, 0)，但输出 Vector(0, 1)
   */
  static mulMatrix(m, v) {
    return new Vector(m.a * v.x + m.c * v.y, m.b * v.x + m.d * v.y);
  }

  /**
   * 判断两个向量是否在精度范围内相等
   * @param {Vector} a - 第一个向量
   * @param {Vector} b - 第二个向量
   * @param {number} [eps = 1e-10] - 允许的误差范围，留空为 1e-10
   * @returns {boolean} 如果两个向量在误差范围内相等则返回 true，否则返回 false
   * @static
   * @example
   * const v1 = new Vector(1, 2);
   * const v2 = new Vector(1.05, 2);
   * console.log(Vector.nearlyEq(v1, v1)); // true
   * console.log(Vector.nearlyEq(v1, v2, 0.01)); // false
   * console.log(Vector.nearlyEq(v1, v2, 0.1)); // true
   */
  static nearlyEq(a, b, eps = 1e-10) {
    return (
      Math.abs(a.x - b.x) <= Math.abs(eps) &&
      Math.abs(a.y - b.y) <= Math.abs(eps)
    );
  }

  /**
   * 计算两向量相减的模长
   * @param {Vector} a - 第一个向量
   * @param {Vector} b - 第二个向量
   * @returns {number} 两向量相减的模长
   * @static
   * @example
   * const v1 = new Vector(0, 0);
   * const v2 = new Vector(3, 4);
   * console.log(Vector.distanceTo(v1, v2)); // 5
   */
  static distanceTo(a, b) {
    return Math.sqrt(Vector.distanceSq(a, b));
  }

  /**
   * 计算两向量相减的模长的平方
   * @param {Vector} a - 第一个向量
   * @param {Vector} b - 第二个向量
   * @returns {number} 两向量相减的模长的平方
   * @static
   * @example
   * const v1 = new Vector(1, 0)
   * const v2 = new Vector(3, 4)
   * console.log(Vector.distanceSq(v1, v2)); // 20
   */
  static distanceSq(a, b) {
    return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
  }

  /**
   * 克隆该向量
   * @returns {Vector} Vector 实例
   * @example
   * let v1 = new Vector(1, 0);
   * let v2 = v1.clone();
   * v2.x = 0;
   * console.log(v1.toString()); // Vector(1, 0)
   * console.log(v2.toString()); // Vector(0, 0)
   */
  clone() {
    return new Vector(this.x, this.y);
  }

  /**
   * 两向量相加
   * @param {Vector} other - 另一个向量
   * @returns {Vector} 两向量相加的结果
   * @example
   * const v1 = new Vector(5, 10);
   * const v2 = new Vector(-2, -3);
   * console.log(v1.add(v2).toString()) // Vector(3, 7)
   */
  add(other) {
    return new Vector(this.x + other.x, this.y + other.y);
  }

  /**
   * 两向量相减
   * @param {Vector} other - 另一个向量，被减向量
   * @returns {Vector} 两向量相减的结果
   * @example
   * const v1 = new Vector(5, 10);
   * const v2 = new Vector(-2, -3);
   * console.log(v1.sub(v2).toString()) // Vector(7, 13)
   */
  sub(other) {
    return new Vector(this.x - other.x, this.y - other.y);
  }

  /**
   * 两向量点乘
   * @param {Vector} other - 另一个向量
   * @returns {number} 两向量点乘的结果
   * @example
   * const v1 = new Vector(5, 10);
   * const v2 = new Vector(-2, -3);
   * console.log(v1.dotMul(v2)) // -40
   */
  dotMul(other) {
    return this.x * other.x + this.y * other.y;
  }

  /**
   * 计算向量的模长
   * @returns {number} 向量的模长
   * @example
   * const vec = new Vector(3, 4);
   * console.log(vec.length()); // 5
   */
  length() {
    return Math.sqrt(this.lengthSq());
  }

  /**
   * 计算向量的模长的平方
   * @returns {number} 向量的模长的平方
   * @example
   * const vec = new Vector(3, 4);
   * console.log(vec.lengthSq()); // 25
   */
  lengthSq() {
    return this.x * this.x + this.y * this.y;
  }

  /**
   * 缩放向量（向量数乘）
   * @param {number} factor - 缩放因子（数乘的倍数）
   * @returns {Vector} 缩放（数乘）后的向量
   * @example
   * const vec = new Vector(3, 4);
   * console.log(vec.scale(2).toString()); // Vector(6, 8)
   */
  scale(factor) {
    return new Vector(this.x * factor, this.y * factor);
  }

  /**
   * 旋转向量
   * @param {number} radian - 旋转角度（弧度制）
   * @returns {Vector} 旋转后的向量
   * @example
   * const vec = new Vector(1, 0);
   * console.log(vec.rotate(Math.PI / 2).toString()); // Vector(0, 1)
   */
  rotate(radian) {
    return Matrix.identity().rotate(radian).mulVector(this);
  }

  /**
   * 将向量归一化为单位向量
   * @returns {Vector} 归一化后的单位向量
   * @example
   * const vec = new Vector(3, 4);
   * console.log(vec.normalize().toString()); // Vector(0.6, 0.8)
   */
  normalize() {
    const len = this.length();
    if (len === 0) {
      return new Vector(0, 0);
    }
    return this.clone().scale(1 / len);
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
   * @returns {{a: number, b: number, c: number, d: number}} 包含 a, b, c, d 的对象
   * @example
   * const mat = new Matrix(10, 30, 20, 40);
   * console.log(mat.serialize()); // { a: 10, b: 20, c: 30, d: 40 }
   */
  serialize() {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  /**
   * 将此对象序列化为数组对象
   * @returns {number[][]} 包含矩阵元素的二维数组
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
    if (!matrix) return null;
    if (matrix instanceof Matrix) return matrix;
    if (Array.isArray(matrix)) {
      if (matrix.length < 2) {
        throw new RangeError("Array must have at least 2 elements");
      }
      if (matrix[0].length < 2 || matrix[1].length < 2) {
        throw new RangeError("Element array must have at least 2 elements");
      }
      return new Matrix(matrix[0][0], matrix[1][0], matrix[0][1], matrix[1][1]);
    }
    if (typeof matrix.a === "number") {
      return new Matrix(matrix.a, matrix.b, matrix.c, matrix.d);
    }
    return null;
  }

  /**
   * 克隆该矩阵
   * @returns {Matrix} Matrix 实例
   * @example
   * let m1 = new Matrix(1, 0, 0, 1);
   * let m2 = m1.clone();
   * m1.a = 0;
   * console.log(m1.toString()); // Matrix[[0, 0], [0, 1]]
   * console.log(m2.toString()); // Matrix[[1, 0], [0, 1]]
   */
  clone() {
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
   * @param {Vector} point - 要应用该矩阵的点
   * @returns {Vector} 返回传入点以支持链式调用
   * @example
   * const m = new Matrix(2, 0, 0, 3);
   * const v = new Vector(1, 2);
   * const r = m.applyToVector(v);
   * console.log(v.toString()); // Vector(2, 6)
   * console.log(r.toString()); // Vector(2, 6)
   */
  applyToVector(point) {
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
      this.d + other.d,
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
      this.d - other.d,
    );
  }

  /**
   * 矩阵-矩阵相乘
   * @param {Matrix} other - 另一个矩阵
   * @returns {Matrix} 相乘的结果
   * @example
   * const m1 = new Matrix(1, 2, 3, 4);
   * const m2 = new Matrix(5, 6, 7, 8);
   * const vec = new Vector(1, 2);
   * console.log(m1.mul(m2).toString()) // Matrix[[23, 31], [34, 46]]
   */
  mul(other) {
    return new Matrix(
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
    );
  }

  /**
   * 矩阵-向量相乘
   * @param {Vector} vec - 要相乘的向量
   * @returns {Vector} 相乘的结果
   * @example
   * const m = new Matrix(1, 2, 3, 4);
   * const v = new Vector(1, 2);
   * console.log(m.mulVector(v).toString()) // Vector(5, 11)
   */
  mulVector(vec) {
    return Vector.mulMatrix(this, vec);
  }

  /**
   * 矩阵缩放（数乘）
   * @param {number} factor - 缩放因子（数乘的倍数）
   * @returns {Matrix} 矩阵缩放的结果
   * @example
   * const m1 = new Matrix(1, 2, 3, 4);
   * console.log(p1.scale(2).toString()) // Matrix[[2, 6], [4, 8]]
   */
  scale(factor) {
    return new Matrix(
      this.a * factor,
      this.b * factor,
      this.c * factor,
      this.d * factor,
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
        Math.cos(radian),
      ),
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

  /**
   * 奇异值分解（SVD）
   * @returns {{u: Matrix, s: Matrix, v: Matrix}} 包含 U、S、V 矩阵的对象
   * @example
   * const mat = new Matrix(1, 2, 3, 4);
   * const { u, s, v } = mat.svd();
   * console.log(u.toString()); // Matrix[[0.4045, -0.9145], [0.9145, 0.4045]]
   * console.log(s.toString()); // Matrix[[5.4649, 0], [0, 0.3659]]
   * console.log(v.toString()); // Matrix[[0.5760, 0.8174], [0.8174, -0.5760]]
   */
  svd() {
    // 由于这是一个 2x2 矩阵，我们可以直接使用特征值分解来计算 SVD
    const ATA = new Matrix(
      this.a * this.a + this.b * this.b,
      this.a * this.c + this.b * this.d,
      this.a * this.c + this.b * this.d,
      this.c * this.c + this.d * this.d,
    );
    const { U: v, S: s } = ATA.eig();
    const S = new Matrix(Math.sqrt(s.a), 0, 0, Math.sqrt(s.d));
    const U = new Matrix(
      (this.a * v.a + this.c * v.c) / S.a,
      (this.b * v.a + this.d * v.c) / S.a,
      (this.a * v.b + this.c * v.d) / S.d,
      (this.b * v.b + this.d * v.d) / S.d,
    );
    return { u: U, s: S, v: v };
  }

  /**
   * 矩阵转置
   * @returns {Matrix} 矩阵转置的结果
   * @example
   * const m1 = new Matrix(1, 2, 3, 4);
   * console.log(m1.transpose().toString()) // Matrix[[1, 3], [2, 4]]
   */
  transpose() {
    return new Matrix(this.a, this.c, this.b, this.d);
  }
}

export { Vector, Matrix };
