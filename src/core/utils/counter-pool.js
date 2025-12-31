/**
 * @descrpition 用对象包了一个 number
 */
class CounterPool {
  counter;

  /**
   * 
   * @param {number} [count = 0] 
   */
  constructor(count = 0) {
    this.counter = count;
  }

  /**
   * @param {number} count
   * @returns {CounterPool}
   */
  init(count) {
    this.counter = count;
    return this;
  }

  generate() {
    this.counter++;
    return this.counter;
  }
}

module.exports = {
  CounterPool,
};
