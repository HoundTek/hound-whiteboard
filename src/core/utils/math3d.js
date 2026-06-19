/**
 * @file 三维数学模块
 * @description
 * 提供三维空间中点和矩阵的表示与操作功能，包括:
 * - 三维点 Vector3D
 * - 3x3 矩阵 Matrix3D
 * @module core/utils/math3d
 * @author Zhou Chenyu
 */

/**
 * 三维向量
 * @class
 * @description 表示三维向量，包含 X、Y 和 Z 坐标，支持矩阵变换
 * @author Zhou Chenyu
 */
class Vector3D {
  /**
   * 向量的 X 坐标
   * @type {number}
   */
  x;

  /**
   * 向量的 Y 坐标
   * @type {number}
   */
  y;

  /**
   * 向量的 Z 坐标
   * @type {number}
   */
  z;

  /**
   * @constructor
   * @param {number} x - 向量的 X 坐标
   * @param {number} y - 向量的 Y 坐标
   * @param {number} z - 向量的 Z 坐标
   */
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * 将此对象序列化为普通 JSON 对象
   * @returns {{x: number, y: number, z: number}} 包含向量坐标的对象
   * @example
   * const v = new Vector3D(10, 20, 30);
   * console.log(v.serialize()); // { x: 10, y: 20, z: 30 }
   */
  serialize() {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
    };
  }

  /**
   * 将此对象序列化为数组对象
   * @returns {number[]} 包含向量坐标的数组
   * @example
   * const v = new Vector3D(10, 20, 30);
   * console.log(v.serializeToArray()); // [10, 20, 30]
   */
  serializeToArray() {
    return [this.x, this.y, this.z];
  }

  /**
   * 将此对象序列化为字符串
   * @returns {String}
   * @example
   * const v = new Vector3D(10, 20, 30);
   * console.log(v.toString()); // Vector3D(10, 20, 30)
   */
  toString() {
    return `Vector3D(${this.x}, ${this.y}, ${this.z})`;
  }

  /**
   * 将序列化的对象转化为 Vector3D 实例
   * @param {{x: number, y: number, z: number}} vec - 包含向量坐标的对象
   * @returns {Vector3D} Vector3D 实例
   * @static
   * @example
   * const vec = Vector3D.parse({ x: 10, y: 20, z: 30 }); // Vector3D(10, 20, 30)
   */
  static parse(vec) {
    if (!vec) return null;
    if (vec instanceof Vector3D) return vec;
    if (Array.isArray(vec)) {
      if (vec.length < 3) {
        throw new RangeError("Array must have at least 3 elements");
      }
      return new Vector3D(vec[0], vec[1], vec[2]);
    }
    if (typeof vec.x === "number" && typeof vec.y === "number" && typeof vec.z === "number") {
      return new Vector3D(vec.x, vec.y, vec.z);
    }
    return null;
  }

  /**
   * 应用变换矩阵
   * @description 此方法会修改当前点的坐标
   * @param {Matrix3D} matrix - 要应用的变换矩阵
   * @returns {Vector3D} 返回自己以支持链式调用
   * @example
   * const matrix = new Matrix3D(1, 0, 0, 0, 1, 0, 10, 20, 1);
   * const vec = new Vector3D(5, 5, 1);
   * vec.applyTransform(matrix);
   * console.log(vec.toString()); // Vector3D(15, 25, 1)
   */
  applyTransform(matrix) {
    let p = Vector3D.mulMatrix(matrix, this);
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    return this;
  }

  /**
   * 将矩阵与向量相乘
   * @description 执行矩阵-向量乘法，返回新的 Vector3D 实例而非修改传入向量
   * @param {Matrix3D} m - 3x3 变换矩阵
   * @param {Vector3D} v - 要变换的向量
   * @returns {Vector3D} 变换后的新向量
   * @example
   * const matrix = new Matrix3D(1, 0, 0, 0, 1, 0, 10, 20, 1);
   * const vec = new Vector3D(5, 5, 1);
   * const transformedVec = Vector3D.mulMatrix(matrix, vec);
   * console.log(transformedVec.toString()); // Vector3D(15, 25, 1)
   */
  static mulMatrix(m, v) {
    const x = m.a11 * v.x + m.a12 * v.y + m.a13 * v.z;
    const y = m.a21 * v.x + m.a22 * v.y + m.a23 * v.z;
    const z = m.a31 * v.x + m.a32 * v.y + m.a33 * v.z;
    return new Vector3D(x, y, z);
  }

  /**
   * 判断两向量是否在精度范围内相等
   * @param {Vector3D} a - 第一个向量
   * @param {Vector3D} b - 第二个向量
   * @param {number} [eps = 1e-10] - 允许的误差范围
   * @returns {boolean} 如果两个向量在误差范围内相等则返回 true，否则返回 false
   * @example
   * const v1 = new Vector3D(10.0000000001, 20.0000000001, 30.0000000001);
   * const v2 = new Vector3D(10.0000000002, 20.0000000002, 30.0000000002);
   * console.log(Vector3D.nearlyEq(v1, v2)); // true
   */
  static nearlyEq(a, b, eps = 1e-10) {
    return (
      Math.abs(a.x - b.x) <= Math.abs(eps) &&
      Math.abs(a.y - b.y) <= Math.abs(eps) &&
      Math.abs(a.z - b.z) <= Math.abs(eps)
    );
  }

  /**
   * 计算两向量相减的模长
   * @param {Vector3D} a - 第一个向量
   * @param {Vector3D} b - 第二个向量
   * @returns {number} 两向量相减的模长
   * @example
   * const v1 = new Vector3D(0, 0, 0);
   * const v2 = new Vector3D(3, 4, 0);
   * console.log(Vector3D.distanceTo(v1, v2)); // 5
   */
  static distanceTo(a, b) {
    return Math.sqrt(Vector3D.distanceSq(a, b));
  }

  /**
   * 计算两向量相减的模长的平方
   * @param {Vector3D} a - 第一个向量
   * @param {Vector3D} b - 第二个向量
   * @returns {number} 两向量相减的模长的平方
   * @example
   * const v1 = new Vector3D(0, 0, 1);
   * const v2 = new Vector3D(3, 4, 0);
   * console.log(Vector3D.distanceSq(v1, v2)); // 26
   */
  static distanceSq(a, b) {
    return (
      (a.x - b.x) * (a.x - b.x) +
      (a.y - b.y) * (a.y - b.y) +
      (a.z - b.z) * (a.z - b.z)
    );
  }

  /**
   * 克隆该向量
   * @returns {Vector3D} Vector3D 实例
   * @example
   * let v1 = new Vector3D(10, 20, 30);
   * let v2 = v1.clone();
   * v1.x = 0;
   * console.log(v1.toString()); // Vector3D(0, 20, 30)
   * console.log(v2.toString()); // Vector3D(10, 20, 30)
   */
  clone() {
    return new Vector3D(this.x, this.y, this.z);
  }

  /**
   * 两向量相加
   * @param {Vector3D} other - 另一个向量
   * @returns {Vector3D} 两向量相加的结果
   * @example
   * const v1 = new Vector3D(1, 2, 3);
   * const v2 = new Vector3D(4, 5, 6);
   * const v3 = v1.add(v2);
   * console.log(v3.toString()); // Vector3D(5, 7, 9)
   */
  add(other) {
    return new Vector3D(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  /**
   * 两向量相减
   * @param {Vector3D} other - 另一个向量
   * @returns {Vector3D} 两向量相减的结果
   * @example
   * const v1 = new Vector3D(4, 5, 6);
   * const v2 = new Vector3D(1, 2, 3);
   * const v3 = v1.sub(v2);
   * console.log(v3.toString()); // Vector3D(3, 3, 3)
   */
  sub(other) {
    return new Vector3D(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  /**
   * 两向量相点乘
   * @param {Vector3D} other - 另一个向量
   * @returns {number} 两向量相点乘的结果
   * @example
   * const v1 = new Vector3D(1, 2, 3);
   * const v2 = new Vector3D(4, 5, 6);
   * const dot = v1.dotMul(v2);
   * console.log(dot); // 32
   */
  dotMul(other) {
    return this.x * other.x + this.y * other.y + this.z * other.z;
  }

  /**
   * 两向量相叉乘
   * @param {Vector3D} other - 另一个向量
   * @returns {Vector3D} 两向量相叉乘的结果
   * @example
   * const v1 = new Vector3D(1, 2, 3);
   * const v2 = new Vector3D(4, 5, 6);
   * const cross = v1.crossMul(v2);
   * console.log(cross.toString()); // Vector3D(-3, 6, -3)
   */
  crossMul(other) {
    return new Vector3D(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x
    );
  }
}

/**
 * 表示一个 3x3 矩阵
 */
class Matrix3D {
  /**
   * 矩阵 [[**a11**, a12, a13], [a21, a22, a23], [a31, a32, a33]] 中的 a11
   * @type {number}
   */
  a11;

  /**
   * 矩阵 [[a11, **a12**, a13], [a21, a22, a23], [a31, a32, a33]] 中的 a12
   * @type {number}
   */
  a12;

  /**
   * 矩阵 [[a11, a12, **a13**], [a21, a22, a23], [a31, a32, a33]] 中的 a13
   * @type {number}
   */
  a13;

  /**
   * 矩阵 [[a11, a12, a13], [**a21**, a22, a23], [a31, a32, a33]] 中的 a21
   * @type {number}
   */
  a21;

  /**
   * 矩阵 [[a11, a12, a13], [a21, **a22**, a23], [a31, a32, a33]] 中的 a22
   * @type {number}
   */
  a22;

  /**
   * 矩阵 [[a11, a12, a13], [a21, a22, **a23**], [a31, a32, a33]] 中的 a23
   * @type {number}
   */
  a23;

  /**
   * 矩阵 [[a11, a12, a13], [a21, a22, a23], [**a31**, a32, a33]] 中的 a31
   * @type {number}
   */
  a31;

  /**
   * 矩阵 [[a11, a12, a13], [a21, a22, a23], [a31, **a32**, a33]] 中的 a32
   * @type {number}
   */
  a32;

  /**
   * 矩阵 [[a11, a12, a13], [a21, a22, a23], [a31, a32, **a33**]] 中的 a33
   * @type {number}
   */
  a33;

  constructor(a11, a12, a13, a21, a22, a23, a31, a32, a33) {
    this.a11 = a11;
    this.a12 = a12;
    this.a13 = a13;
    this.a21 = a21;
    this.a22 = a22;
    this.a23 = a23;
    this.a31 = a31;
    this.a32 = a32;
    this.a33 = a33;
  }

  /**
   * 构建单位矩阵
   * @returns {Matrix3D} Matrix3D(1, 0, 0, 0, 1, 0, 0, 0, 1)
   * @example
   * const mat = Matrix3D.identity();
   * console.log(mat.toString()); // Matrix3D[[1, 0, 0], [0, 1, 0], [0, 0, 1]]
   */
  static identity() {
    return new Matrix3D(1, 0, 0, 0, 1, 0, 0, 0, 1);
  }

  /**
   * 将此对象序列化为普通 JSON 对象
   * @returns {{a11: number, a12: number, a13: number, a21: number, a22: number, a23: number, a31: number, a32: number, a33: number}} 包含矩阵元素的对象
   * @example
   * const mat = new Matrix3D(10, 20, 30, 40, 50, 60, 70, 80, 90);
   * console.log(mat.serialize()); // { a11: 10, a12: 20, a13: 30, a21: 40, a22: 50, a23: 60, a31: 70, a32: 80, a33: 90 }
   */
  serialize() {
    return {
      a11: this.a11,
      a12: this.a12,
      a13: this.a13,
      a21: this.a21,
      a22: this.a22,
      a23: this.a23,
      a31: this.a31,
      a32: this.a32,
      a33: this.a33,
    };
  }

  /**
   * 将此对象序列化为数组对象
   * @returns {number[][]} 包含矩阵元素的二维数组
   * @example
   * const mat = new Matrix3D(10, 20, 30, 40, 50, 60, 70, 80, 90);
   * console.log(mat.serializeToArray()); // [[10, 20, 30], [40, 50, 60], [70, 80, 90]]
   */
  serializeToArray() {
    return [
      [this.a11, this.a12, this.a13],
      [this.a21, this.a22, this.a23],
      [this.a31, this.a32, this.a33],
    ];
  }

  /**
   * 将此对象序列化为字符串
   * @returns {String}
   * @example
   * const mat = new Matrix3D(10, 20, 30, 40, 50, 60, 70, 80, 90);
   * console.log(mat.toString()); // Matrix3D[[10, 20, 30], [40, 50, 60], [70, 80, 90]]
   */
  toString() {
    return `Matrix3D[[${this.a11}, ${this.a12}, ${this.a13}], [${this.a21}, ${this.a22}, ${this.a23}], [${this.a31}, ${this.a32}, ${this.a33}]]`;
  }

  /**
   * 将序列化的对象转化为 Matrix3D 实例
   * @param {{a11: number, a12: number, a13: number, a21: number, a22: number, a23: number, a31: number, a32: number, a33: number}} matrix - 包含矩阵元素的对象
   * @returns {Matrix3D} Matrix3D 实例
   * @static
   * @example
   * const matrix = Matrix3D.parse({ a11: 10, a12: 20, a13: 30, a21: 40, a22: 50, a23: 60, a31: 70, a32: 80, a33: 90 }); // Matrix3D[[10, 20, 30], [40, 50, 60], [70, 80, 90]]
   */
  static parse(matrix) {
    if (!matrix) return null;
    if (matrix instanceof Matrix3D) return matrix;
    if (Array.isArray(matrix)) {
      if (matrix.length < 3) {
        throw new RangeError("Array must have at least 3 elements");
      }
      if (matrix[0].length < 3 || matrix[1].length < 3 || matrix[2].length < 3) {
        throw new RangeError("Element array must have at least 3 elements");
      }
      return new Matrix3D(
        matrix[0][0], matrix[0][1], matrix[0][2],
        matrix[1][0], matrix[1][1], matrix[1][2],
        matrix[2][0], matrix[2][1], matrix[2][2],
      );
    }
    if (typeof matrix.a11 === "number") {
      return new Matrix3D(
        matrix.a11, matrix.a12, matrix.a13,
        matrix.a21, matrix.a22, matrix.a23,
        matrix.a31, matrix.a32, matrix.a33
      );
    }
    return null;
  }

  /**
   * 克隆该矩阵
   * @returns {Matrix3D} Matrix3D 实例
   * @example
   * let m1 = new Matrix3D(1, 0, 0, 0, 1, 0, 0, 0, 1);
   * let m2 = m1.clone();
   * m1.a11 = 0;
   * console.log(m1.toString()); // Matrix3D[[0, 0, 0], [0, 1, 0], [0, 0, 1]]
   * console.log(m2.toString()); // Matrix3D[[1, 0, 0], [0, 1, 0], [0, 0, 1]]
   */
  clone() {
    return new Matrix3D(
      this.a11,
      this.a12,
      this.a13,
      this.a21,
      this.a22,
      this.a23,
      this.a31,
      this.a32,
      this.a33
    );
  }

  /**
   * 获取矩阵内某元素
   * @param {0 | 1 | 2} x
   * @param {0 | 1 | 2} y
   * @returns {number}
   * @throws {RangeError} - 当 `x` 或 `y` 不为 0、1 或 2 时
   * @example
   * const matrix = new Matrix3D(10, 20, 30, 40, 50, 60, 70, 80, 90);
   * console.log(matrix.get(0, 0)); // 10
   * console.log(matrix.get(1, 0)); // 40
   * console.log(matrix.get(2, 0)); // 70
   * console.log(matrix.get(0, 1)); // 20
   * console.log(matrix.get(1, 1)); // 50
   * console.log(matrix.get(2, 1)); // 80
   * console.log(matrix.get(0, 2)); // 30
   * console.log(matrix.get(1, 2)); // 60
   * console.log(matrix.get(2, 2)); // 90
   */
  get(x, y) {
    if (x == 0 && y == 0) {
      return this.a11;
    } else if (x == 0 && y == 1) {
      return this.a12;
    } else if (x == 0 && y == 2) {
      return this.a13;
    } else if (x == 1 && y == 0) {
      return this.a21;
    } else if (x == 1 && y == 1) {
      return this.a22;
    } else if (x == 1 && y == 2) {
      return this.a23;
    } else if (x == 2 && y == 0) {
      return this.a31;
    } else if (x == 2 && y == 1) {
      return this.a32;
    } else if (x == 2 && y == 2) {
      return this.a33;
    }
    throw new RangeError("x or y must be 0, 1 or 2");
  }

  /**
   * 获取矩阵内某元素
   * @param {number[]} arr
   * @returns {number}
   * @throws {RangeError} - 当 `arr` 长度小于 2，或 `x` 或 `y` 不为 0、1 或 2 时
   * @example
   * const matrix = new Matrix3D(10, 20, 30, 40, 50, 60, 70, 80, 90);
   * console.log(matrix.getFromArr([0, 0])); // 10
   * console.log(matrix.getFromArr([1, 0])); // 40
   * console.log(matrix.getFromArr([2, 0])); // 70
   * console.log(matrix.getFromArr([0, 1])); // 20
   * console.log(matrix.getFromArr([1, 1])); // 50
   * console.log(matrix.getFromArr([2, 1])); // 80
   * console.log(matrix.getFromArr([0, 2])); // 30
   * console.log(matrix.getFromArr([1, 2])); // 60
   * console.log(matrix.getFromArr([2, 2])); // 90
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
   * 使用此矩阵变换一个三维点
   * @param {Vector3D} point - 被变换的点
   * @returns {Vector3D} 变换后的点
   * @example
   * const matrix = new Matrix3D(1, 0, 0, 0, 1, 0, 10, 20, 1);
   * const point = new Vector3D(5, 5, 1);
   * const transformedPoint = matrix.applyToVector(point);
   * console.log(transformedPoint.toString()); // Vector3D(15, 25, 1)
   */
  applyToVector(point) {
    return point.applyTransform(this);
  }

  /**
   * 两矩阵相加
   * @param {Matrix3D} other - 另一个矩阵
   * @returns {Matrix3D} 两矩阵相加的结果
   * @example
   * const m1 = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
   * const m2 = new Matrix3D(9, 8, 7, 6, 5, 4, 3, 2, 1);
   * const m3 = m1.add(m2);
   * console.log(m3.toString()); // Matrix3D[[10, 10, 10], [10, 10, 10], [10, 10, 10]]
   */
  add(other) {
    return new Matrix3D(
      this.a11 + other.a11,
      this.a12 + other.a12,
      this.a13 + other.a13,
      this.a21 + other.a21,
      this.a22 + other.a22,
      this.a23 + other.a23,
      this.a31 + other.a31,
      this.a32 + other.a32,
      this.a33 + other.a33
    );
  }
  /**
   * 两矩阵相减
   * @param {Matrix3D} other - 另一个矩阵
   * @returns {Matrix3D} 两矩阵相减的结果
   * @example
   * const m1 = new Matrix3D(5, 6, 7, 8, 9, 10, 11, 12, 13);
   * const m2 = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
   * const m3 = m1.sub(m2);
   * console.log(m3.toString()); // Matrix3D[[4, 4, 4], [4, 4, 4], [4, 4, 4]]
   */
  sub(other) {
    return new Matrix3D(
      this.a11 - other.a11,
      this.a12 - other.a12,
      this.a13 - other.a13,
      this.a21 - other.a21,
      this.a22 - other.a22,
      this.a23 - other.a23,
      this.a31 - other.a31,
      this.a32 - other.a32,
      this.a33 - other.a33
    );
  }

  /**
   * 两矩阵相乘
   * @param {Matrix3D} other - 另一个矩阵
   * @returns {Matrix3D} 两矩阵相乘的结果
   * @example
   * const m1 = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
   * const m2 = new Matrix3D(9, 8, 7, 6, 5, 4, 3, 2, 1);
   * const m3 = m1.mul(m2);
   * console.log(m3.toString()); // Matrix3D[[30, 24, 18], [84, 69, 54], [138, 114, 90]]
   */
  mul(other) {
    return new Matrix3D(
      this.a11 * other.a11 + this.a12 * other.a21 + this.a13 * other.a31,
      this.a11 * other.a12 + this.a12 * other.a22 + this.a13 * other.a32,
      this.a11 * other.a13 + this.a12 * other.a23 + this.a13 * other.a33,

      this.a21 * other.a11 + this.a22 * other.a21 + this.a23 * other.a31,
      this.a21 * other.a12 + this.a22 * other.a22 + this.a23 * other.a32,
      this.a21 * other.a13 + this.a22 * other.a23 + this.a23 * other.a33,

      this.a31 * other.a11 + this.a32 * other.a21 + this.a33 * other.a31,
      this.a31 * other.a12 + this.a32 * other.a22 + this.a33 * other.a32,
      this.a31 * other.a13 + this.a32 * other.a23 + this.a33 * other.a33
    );
  }

  /**
   * 矩阵缩放（数乘）
   * @param {number} scale - 要放大的倍数
   * @returns {Matrix3D} 矩阵缩放的结果
   * @example
   * const m1 = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
   * console.log(m1.scale(2).toString()); // Matrix3D[[2, 4, 6], [8, 10, 12], [14, 16, 18]]
   */
  scale(scale) {
    return new Matrix3D(
      this.a11 * scale,
      this.a12 * scale,
      this.a13 * scale,
      this.a21 * scale,
      this.a22 * scale,
      this.a23 * scale,
      this.a31 * scale,
      this.a32 * scale,
      this.a33 * scale
    );
  }

  /**
   * 计算该矩阵的行列式
   * @returns {number} 该矩阵的行列式
   * @example
   * const m = new Matrix3D(1, 2, 3, 4, 5, 6, 7, 8, 9);
   * console.log(m.det()); // 0
   */
  det() {
    return (
      this.a11 * (this.a22 * this.a33 - this.a23 * this.a32) -
      this.a12 * (this.a21 * this.a33 - this.a23 * this.a31) +
      this.a13 * (this.a21 * this.a32 - this.a22 * this.a31)
    );
  }

  /**
   * 计算该矩阵的逆矩阵
   * @throws {Error} 当该矩阵不可逆时（行列式为 0）
   * @returns {Matrix3D} 该矩阵的逆矩阵
   * @example
   * const m = new Matrix3D(1, 2, 3, 0, 1, 4, 5, 6, 0);
   * const invM = m.inv();
   * console.log(invM.toString()); // Matrix3D[[-24, 18, 5], [20, -15, -4], [-5, 4, 1]]
   */
  inv() {
    const det = this.det();
    if (Math.abs(det) < 1e-10) {
      throw new Error("Matrix is not invertible (determinant is zero)");
    }
    const a11 = this.a22 * this.a33 - this.a23 * this.a32;
    const a12 = -(this.a12 * this.a33 - this.a13 * this.a32);
    const a13 = this.a12 * this.a23 - this.a13 * this.a22;

    const a21 = -(this.a21 * this.a33 - this.a23 * this.a31);
    const a22 = this.a11 * this.a33 - this.a13 * this.a31;
    const a23 = -(this.a11 * this.a23 - this.a13 * this.a21);

    const a31 = this.a21 * this.a32 - this.a22 * this.a31;
    const a32 = -(this.a11 * this.a32 - this.a12 * this.a31);
    const a33 = this.a11 * this.a22 - this.a12 * this.a21;

    return new Matrix3D(a11, a12, a13, a21, a22, a23, a31, a32, a33).scale(
      1.0 / det
    );
  }

  /**
   * 判断两矩阵是否在精度范围内相等
   * @param {Matrix3D} a - 第一个矩阵
   * @param {Matrix3D} b - 第二个矩阵
   * @param {number} eps - 精度，默认为 1e-10
   * @returns {boolean}
   * @example
   * const m1 = new Matrix3D(1,2,3,4,5,6,7,8,9);
   * const m2 = new Matrix3D(1,2,3,4,5,6,7,8,9.000000001);
   * console.log(Matrix3D.nearlyEq(m1, m2)); // true
   * console.log(Matrix3D.nearlyEq(m1, m2, 1e-12)); // false
   */
  static nearlyEq(a, b, eps = 1e-10) {
    return (
      Math.abs(a.a11 - b.a11) <= Math.abs(eps) &&
      Math.abs(a.a12 - b.a12) <= Math.abs(eps) &&
      Math.abs(a.a13 - b.a13) <= Math.abs(eps) &&
      Math.abs(a.a21 - b.a21) <= Math.abs(eps) &&
      Math.abs(a.a22 - b.a22) <= Math.abs(eps) &&
      Math.abs(a.a23 - b.a23) <= Math.abs(eps) &&
      Math.abs(a.a31 - b.a31) <= Math.abs(eps) &&
      Math.abs(a.a32 - b.a32) <= Math.abs(eps) &&
      Math.abs(a.a33 - b.a33) <= Math.abs(eps)
    );
  }
}

export {
  Matrix3D,
  Vector3D,
};
