/**
 * 计数器池
 * @module core/utils/counter-pool
 * @author Zhou Chenyu
 */

/**
 * 计数器池
 * @class
 * @author Zhou Chenyu
 */
class CounterPool {
  /**
   * 计数器
   * @type {number}
   */
  counter;

  /**
   * @constructor
   * @param {number} [count = 0] - 初始计数值
   */
  constructor(count = 0) {
    this.counter = count;
  }

  /**
   * 初始化计数器池
   * @param {number} [count = 0] - 初始计数值
   * @returns {CounterPool} 返回自身以支持链式调用
   */
  init(count = 0) {
    this.counter = count;
    return this;
  }

  /**
   * 生成下一个数字
   * @returns {number}
   */
  generate() {
    this.counter++;
    return this.counter;
  }
}

export {
  CounterPool,
};
