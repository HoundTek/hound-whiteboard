/**
 * @file 算法模块
 * @module algorithm
 * @description 功能：
 * - 随机数池
 * - 计算双指和三指操作的矩阵
 */

import { randomInt } from "crypto";
import { Matrix, Vector } from "./math.js";

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
 * @param {Vector} originPoint1 - 原始点一
 * @param {Vector} originPoint2 - 原始点二
 * @param {Vector} transformedPoint1 - 变换后的点一
 * @param {Vector} transformedPoint2 - 变换后的点二
 * @param {Vector} originCenter - 一开始的变换中心点
 * @returns {{mat: Matrix, vec: Vector}} mat 是旋转缩放矩阵，vec 是平移向量
 * @description 通过两个点的变换来计算出一个仿射变换矩阵，适用于双指操作的情况。
 * 该函数假设变换是由旋转、缩放和平移组成的（两基垂直），并且两个点之间的相对位置关系保持不变。
 */
function getDualFingerResult(
  originPoint1,
  originPoint2,
  transformedPoint1,
  transformedPoint2,
  originCenter,
) {
  const oVec = originPoint1.sub(originPoint2);
  const tVec = transformedPoint1.sub(transformedPoint2);
  const oDist = oVec.length();
  const tDist = tVec.length();
  if (oDist === 0 || tDist === 0) {
    return { mat: Matrix.identity(), vec: transformedPoint1.sub(originPoint1) };
  }
  const scale = tDist / oDist;
  const angle = Math.atan2(tVec.y, tVec.x) - Math.atan2(oVec.y, oVec.x);
  const mat = Matrix.identity().rotate(angle).scale(scale);
  const vec = transformedPoint1
    .sub(mat.multiply(originPoint1.sub(originCenter)))
    .sub(originCenter);
  return { mat, vec };
}

/**
 * 获取三指操作的变换矩阵
 *
 * @param {Vector} originPoint1 - 原始点一
 * @param {Vector} originPoint2 - 原始点二
 * @param {Vector} originPoint3 - 原始点三
 * @param {Vector} transformedPoint1 - 变换后的点一
 * @param {Vector} transformedPoint2 - 变换后的点二
 * @param {Vector} transformedPoint3 - 变换后的点三
 * @param {Vector} originCenter - 一开始的变换中心点
 * @returns {{mat: Matrix, vec: Vector}} mat 是旋转缩放矩阵，vec 是平移向量
 * @description 通过三个点的变换来计算出一个仿射变换矩阵，适用于三指操作的情况。
 * 该函数可以处理更复杂的变换，包括非等比缩放和任意旋转。
 */
function getTriFingerResult(
  originPoint1,
  originPoint2,
  originPoint3,
  transformedPoint1,
  transformedPoint2,
  transformedPoint3,
  originCenter,
) {
  // 思路：通过三个点的变换来计算出一个仿射变换矩阵。
  // 首先计算出原始点和变换后点的质心，然后将点平移到以质心为中心的坐标系中。
  // 接着计算出原始点和变换后点的协方差矩阵，并通过奇异值分解来得到旋转矩阵。
  // 最后计算出缩放因子，并组合成最终的仿射变换矩阵。
  const oCentroid = originPoint1
    .add(originPoint2)
    .add(originPoint3)
    .scale(1 / 3);
  const tCentroid = transformedPoint1
    .add(transformedPoint2)
    .add(transformedPoint3)
    .scale(1 / 3);
  const oMat = [
    originPoint1.sub(oCentroid),
    originPoint2.sub(oCentroid),
    originPoint3.sub(oCentroid),
  ];
  const tMat = [
    transformedPoint1.sub(tCentroid),
    transformedPoint2.sub(tCentroid),
    transformedPoint3.sub(tCentroid),
  ];
  const covMat = [
    [0, 0],
    [0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    covMat[0][0] += oMat[i].x * tMat[i].x;
    covMat[0][1] += oMat[i].x * tMat[i].y;
    covMat[1][0] += oMat[i].y * tMat[i].x;
    covMat[1][1] += oMat[i].y * tMat[i].y;
  }
  const { u, v } = Matrix.parseFromArray(covMat).svd();
  const rotMat = v.mul(u.transpose());
  const oDist = Math.sqrt(
    oMat.reduce((sum, vec) => sum + vec.x * vec.x + vec.y * vec.y, 0) / 3,
  );
  const tDist = Math.sqrt(
    tMat.reduce((sum, vec) => sum + vec.x * vec.x + vec.y * vec.y, 0) / 3,
  );
  const scale = tDist / oDist;
  const mat = rotMat.scale(scale);
  const vec = tCentroid.sub(mat.mulVector(oCentroid)).sub(originCenter);
  return { mat, vec };
}

export { RandomNumberPool };
