/**
 * 随机数相关算法
 * @module core/utils/random
 * @description 功能：
 */

/**
 * 生成 [min, max) 范围内的密码学安全随机整数（浏览器兼容）
 * @param {number} min - 包含
 * @param {number} max - 不包含
 * @returns {number}
 */
function randomInt(min, max) {
  const range = max - min;
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return min + (buf[0] % range);
}

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

export { RandomNumberPool };
