/**
 * @file 算法模块
 * @module algorithm
 * @description 功能：
 * - 随机数池
 * - 计算双指和三指操作的矩阵
 */

const { randomInt } = require("crypto");

/**
 * 不重复的随机数池
 * @class
 * @example
 * let pool = new RandomNumberPool(114514, 114516);
 * pool.initFromArray([1, 2, 3, 114515]); // 只会添加 114515
 * // 此时 pool.length 为 1
 * let rnum1 = pool.generate();
 * let rnum2 = pool.generate();
 * // rnum1 和 rnum2 为 114514 和 114515
 * try {
 *   let rnum3 = pool.generate();
 * } catch (err) {
 *   console.log(err);
 *   // 因为池子已经满了，所以会报错
 * }
 * pool.remove(rnum1); // 返回 true
 * pool.remove(rnum1); // 返回 false (删除未成功，因为池中已经没有这个数了)
 */
class RandomNumberPool {
  /**
   * 随机数池的最小值
   * @type {number}
   */
  min;

  /**
   * 随机数池的最大值
   * @type {number}
   */
  max;

  /**
   * 随机数池中数的数量
   * @type {number}
   */
  length;

  /**
   * 随机数池的映射
   * @type {Set<number>}
   */
  pool;

  /**
   * 创建随机数池
   * @param {number} min 随机数的最小值
   * @param {number} max 随机数的最大值
   */
  constructor(min, max) {
    this.min = min;
    this.max = max;
    this.length = 0;
    this.pool = new Set();
  }

  /**
   * 用数组初始化随机数池
   * @param {number[]} arr 用于初始化的数字数组
   */
  initFromArray(arr) {
    this.pool.clear();
    this.length = 0;
    for (let i = 0; i < arr.length; i++) {
      if (this.min <= arr[i] && arr[i] <= this.max) {
        this.pool.add(arr[i]);
        this.length++;
      }
    }
  }

  /**
   * 向随机池中添加指定数字
   * @param {number} num - 要添加的数字
   * @returns {boolean} 是否成功添加
   */
  add(num) {
    if (!(this.min <= num && num <= this.max)) return false;
    if (this.pool.has(num)) return false;
    this.pool.add(num);
    this.length++;
    return true;
  }

  /**
   * 查询指定数字是否在随机池中
   * @param {number} num - 要添加的数字
   * @returns {boolean} 是否成功添加
   */
  include(num) {
    if (!(this.min <= num && num <= this.max)) return false;
    return this.pool.has(num);
  }

  /**
   * 查询该池是否已满
   * @returns {boolean} 是否已满
   */
  isFull() {
    return this.length == this.max - this.min + 1;
  }

  /**
   * 生成不重复的随机数
   * @returns {number} 生成的随机数
   * @throws {Error} 当随机数池已被占满时
   */
  generate() {
    if (this.isFull()) {
      throw new Error("RandomNumberPool: no space for a new number");
    }
    let num;
    do {
      num = randomInt(this.min, this.max + 1);
    } while (this.pool.has(num));
    this.pool.add(num);
    this.length++;
    return num;
  }

  /**
   * 从随机池中删除指定数字
   * @param {number} num 要删除的数字
   * @returns {boolean} 是否成功删除
   */
  remove(num) {
    if (!this.pool.has(num)) return false;
    this.pool.delete(num);
    this.length--;
    return true;
  }

  /**
   * 在池中重新生成一个不重复的数字
   * @param {number} num 要替换的数字
   * @returns {number} 新生成的数字
   */
  rename(num) {
    let newNum = this.generate();
    this.remove(num);
    return newNum;
  }
}

/**
 * 获取二指操作的变换矩阵
 *
 * @bug 这个算法其实有点问题，计算 a b c d 是对的，但是 e 和 f 是错的
 *
 * @param {number} x1 原始点一的横坐标
 * @param {number} y1 原始点一的纵坐标
 * @param {number} x2 原始点二的横坐标
 * @param {number} y2 原始点二的纵坐标
 * @param {number} x1q 变换后的点一的横坐标
 * @param {number} y1q 变换后的点一的纵坐标
 * @param {number} x2q 变换后的点二的横坐标
 * @param {number} y2q 变换后的点二的纵坐标
 * @param {number} aq 原矩阵的 a
 * @param {number} bq 原矩阵的 b
 * @param {number} cq 原矩阵的 c
 * @param {number} dq 原矩阵的 d
 * @param {number} eq 原矩阵的 e
 * @param {number} fq 原矩阵的 f
 * @returns {Object} a, b, c, d, e, f, 为 ctx.transform() 的参数
 */
function getDualFingerResult(
  x1,
  y1,
  x2,
  y2,
  x1q,
  y1q,
  x2q,
  y2q,
  aq,
  bq,
  cq,
  dq,
  eq,
  fq
) {
  // 计算矩阵 A = [[a c][b d]] 使 A * [[x1 - x2][y1 - y2]] = [[x1q - x2q][y1q - y2q]]
  let delta = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
  let a = ((x1 - x2) * (x1q - x2q) + (y1 - y2) * (y1q - y2q)) / delta;
  let b = ((x1 - x2) * (y1q - y2q) - (y1 - y2) * (x1q - x2q)) / delta;
  let c = -b;
  let d = a;
  // [[ap cp][bp dp]] 是对其中单个向量而言的变换矩阵
  let deltap = aq * dq - bq * cq;
  let ap = (dq * (aq * a + cq * b) - bq * (aq * c + cq * d)) / deltap;
  let bp = (dq * (bq * a + dq * b) - bq * (bq * c + dq * d)) / deltap;
  let cp = (aq * (aq * c + cq * d) - cq * (aq * a + cq * b)) / deltap;
  let dp = (aq * (bq * c + dq * d) - cq * (bq * a + dq * b)) / deltap;
  // [[x2][y2]] 仅经过缩放和旋转时所得到的点为 [[x2p][y2p]]
  let x2p = ap * (x2 - eq) + cp * (y2 - fq) + eq;
  let y2p = bp * (x2 - eq) + dp * (y2 - fq) + fq;
  // dx 和 dy 是相对于屏幕的绝对坐标系而言的
  let dx = x2q - x2p;
  let dy = y2q - y2p;
  // e 和 f 是相对于上一个变换的坐标系而言的
  let e = (dq * dx - cq * dy) / (dq * aq - cq * bq);
  let f = (bq * dx - aq * dy) / (bq * cq - aq * dq);
  // 返回矩阵 [[a c e][b d f][0 0 1]] 中的 a, b, c, d, e, f
  return {
    a: a,
    b: b,
    c: c,
    d: d,
    e: e,
    f: f,
  };
}

/**
 * 获取三指操作的变换矩阵
 *
 * @bug 这个算法其实有点问题，计算 a b c d 是对的，但是 e 和 f 是错的
 *
 * @param {number} x1 原始点一的横坐标
 * @param {number} y1 原始点一的纵坐标
 * @param {number} x2 原始点二的横坐标
 * @param {number} y2 原始点二的纵坐标
 * @param {number} x3 原始点三的横坐标
 * @param {number} y3 原始点三的纵坐标
 * @param {number} x1q 变换后的点一的横坐标
 * @param {number} y1q 变换后的点一的纵坐标
 * @param {number} x2q 变换后的点二的横坐标
 * @param {number} y2q 变换后的点二的纵坐标
 * @param {number} x3q 变换后的点三的横坐标
 * @param {number} y3q 变换后的点三的纵坐标
 * @param {number} aq 原矩阵的 a
 * @param {number} bq 原矩阵的 b
 * @param {number} cq 原矩阵的 c
 * @param {number} dq 原矩阵的 d
 * @param {number} eq 原矩阵的 e
 * @param {number} fq 原矩阵的 f
 * @returns {Object} a, b, c, d, e, f, 为 ctx.transform() 的参数
 */
function getTriFingerResult(
  x1,
  y1,
  x2,
  y2,
  x3,
  y3,
  x1q,
  y1q,
  x2q,
  y2q,
  x3q,
  y3q,
  aq,
  bq,
  cq,
  dq,
  eq,
  fq
) {
  // 计算矩阵 A = [[a c][b d]] 使：
  // A * [[x1 - x2][y1 - y2]] = [[x1q - x2q][y1q - y2q]]
  // A * [[x1 - x3][y1 - y3]] = [[x1q - x3q][y1q - y3q]]
  let delta = (x1 - x2) * (y1 - y3) - (x1 - x3) * (y1 - y2);
  let a = ((x1q - x2q) * (y1 - y3) - (x1q - x3q) * (y1 - y2)) / delta;
  let b = ((x1q - x2q) * (x1 - x3) - (x1q - x3q) * (x1 - x2)) / delta;
  let c = ((y1q - y2q) * (y1 - y3) - (y1q - y3q) * (y1 - y2)) / -delta;
  let d = ((y1q - y2q) * (x1 - x3) - (y1q - y3q) * (x1 - x2)) / -delta;
  // [[ap cp][bp dp]] 是对其中单个向量而言的变换矩阵
  let deltaq = aq * dq - bq * cq;
  let ap = (dq * (aq * a + cq * b) - bq * (aq * c + cq * d)) / deltaq;
  let bp = (dq * (bq * a + dq * b) - bq * (bq * c + dq * d)) / deltaq;
  let cp = (aq * (aq * c + cq * d) - cq * (aq * a + cq * b)) / deltaq;
  let dp = (aq * (bq * c + dq * d) - cq * (bq * a + dq * b)) / deltaq;
  // [[x2][y2]] 仅经过缩放和旋转时所得到的点为 [[x2p][y2p]]
  let x2p = ap * (x2 - eq) + cp * (y2 - fq) + eq;
  let y2p = bp * (x2 - eq) + dp * (y2 - fq) + fq;
  // dx 和 dy 是相对于屏幕的绝对坐标系而言的
  let dx = x2q - x2p;
  let dy = y2q - y2p;
  // e 和 f 是相对于上一个变换的坐标系而言的
  let e = (dq * dx - cq * dy) / (dq * aq - cq * bq);
  let f = (bq * dx - aq * dy) / (bq * cq - aq * dq);
  // 返回矩阵 [[a c e][b d f][0 0 1]] 中的 a, b, c, d, e, f
  return {
    a: a,
    b: b,
    c: c,
    d: d,
    e: e,
    f: f,
  };
}

module.exports = {
  getDualFingerResult,
  getTriFingerResult,
  RandomNumberPool,
};
