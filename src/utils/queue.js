/**
 * @file 队列
 * @module queue
 * @author Zhou Chenyu
 */

/**
 * 队列
 * @author Zhou Chenyu
 */
class Queue {
  /**
   * 循环数组存储元素
   * @type {Array<any>}
   */
  elements;

  /**
   * 队头下标
   * @type {number}
   */
  head;

  /**
   * 队尾下标
   * @type {number}
   */
  tail;

  /**
   * 数组容量
   * @type {number}
   */
  capacity;

  /**
   * 初始容量
   * @type {number}
   * @private
   */
  static INITIAL_CAPACITY = 8;

  /**
   * 扩容因子
   * @type {number}
   * @private
   */
  static GROWTH_FACTOR = 2;

  /**
   * @constructor
   */
  constructor() {
    this.capacity = Queue.INITIAL_CAPACITY;
    this.elements = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
  }

  /**
   * 入队
   * @param {any} elem - 要入队的元素
   */
  push(elem) {
    // 检查是否需要扩容（预留一个空位用于区分满和空）
    if ((this.tail + 1) % this.capacity === this.head) {
      this._resize();
    }
    this.elements[this.tail] = elem;
    this.tail = (this.tail + 1) % this.capacity;
  }

  /**
   * 出队
   * @throws {RangeError} 当队列为空时
   * @returns {any}
   */
  pop() {
    if (this.empty()) {
      throw new RangeError("Queue is empty");
    }
    const item = this.elements[this.head];
    this.elements[this.head] = undefined; // 避免内存泄漏
    this.head = (this.head + 1) % this.capacity;
    return item;
  }

  /**
   * 队列元素个数
   * @returns {number}
   */
  count() {
    return (this.tail - this.head + this.capacity) % this.capacity;
  }

  /**
   * 队列是否为空
   * @returns {boolean} 队列是否为空，若为空，返回 true，若不为空，返回 false
   */
  empty() {
    return this.head === this.tail;
  }

  /**
   * 获取队头元素
   * @throws {RangeError} 当队列为空时
   * @returns {any}
   */
  peek() {
    if (this.empty()) {
      throw new RangeError("Queue is empty");
    }
    return this.elements[this.head];
  }

  /**
   * 清空队列
   */
  clear() {
    this.capacity = Queue.INITIAL_CAPACITY;
    this.elements = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
  }

  /**
   * 动态扩容
   * @private
   */
  _resize() {
    const oldCapacity = this.capacity;
    const newCapacity = oldCapacity * Queue.GROWTH_FACTOR;
    const newElements = new Array(newCapacity);

    // 将元素复制到新数组（保持顺序）
    let count = 0;
    let i = this.head;
    while (i !== this.tail) {
      newElements[count++] = this.elements[i];
      i = (i + 1) % oldCapacity;
    }

    this.elements = newElements;
    this.capacity = newCapacity;
    this.head = 0;
    this.tail = count;
  }
}

module.exports = {
  Queue,
};
