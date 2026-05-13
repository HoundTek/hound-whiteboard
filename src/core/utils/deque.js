/**
 * 双端队列
 * @module core/utils/deque
 * @author Zhou Chenyu
 */

/**
 * 双端队列
 * @class
 * @author Zhou Chenyu
 */
class Deque {
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
    this.capacity = Deque.INITIAL_CAPACITY;
    this.elements = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
  }

  /**
   * 从队尾入队
   * @param {any} elem - 要入队的元素
   */
  pushBack(elem) {
    // 检查是否需要扩容（预留一个空位用于区分满和空）
    if ((this.tail + 1) % this.capacity === this.head) {
      this.#resize();
    }
    this.elements[this.tail] = elem;
    this.tail = (this.tail + 1) % this.capacity;
  }

  /**
   * 从队头入队
   * @param {any} elem - 要入队的元素
   */
  pushFront(elem) {
    // 检查是否需要扩容（预留一个空位用于区分满和空）
    if ((this.tail + 1) % this.capacity === this.head) {
      this.#resize();
    }
    // head 向前移动（循环）
    this.head = (this.head - 1 + this.capacity) % this.capacity;
    this.elements[this.head] = elem;
  }

  /**
   * 从队头出队
   * @throws {RangeError} 当队列为空时
   * @returns {any}
   */
  popFront() {
    if (this.empty()) {
      throw new RangeError("Deque is empty");
    }
    const item = this.elements[this.head];
    this.elements[this.head] = undefined; // 避免内存泄漏
    this.head = (this.head + 1) % this.capacity;
    return item;
  }

  /**
   * 从队尾出队
   * @throws {RangeError} 当队列为空时
   * @returns {any}
   */
  popBack() {
    if (this.empty()) {
      throw new RangeError("Deque is empty");
    }
    // tail 向前移动（循环）
    this.tail = (this.tail - 1 + this.capacity) % this.capacity;
    const item = this.elements[this.tail];
    this.elements[this.tail] = undefined; // 避免内存泄漏
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
  peekFront() {
    if (this.empty()) {
      throw new RangeError("Deque is empty");
    }
    return this.elements[this.head];
  }

  /**
   * 获取队尾元素
   * @throws {RangeError} 当队列为空时
   * @returns {any}
   */
  peekBack() {
    if (this.empty()) {
      throw new RangeError("Deque is empty");
    }
    // 队尾元素在 tail - 1 位置
    const backIndex = (this.tail - 1 + this.capacity) % this.capacity;
    return this.elements[backIndex];
  }

  /**
   * 清空队列
   */
  clear() {
    this.capacity = Deque.INITIAL_CAPACITY;
    this.elements = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
  }

  /**
   * 转换为数组
   * @returns {Array<any>}
   */
  toArray() {
    const result = [];
    let index = this.head;
    while (index !== this.tail) {
      result.push(this.elements[index]);
      index = (index + 1) % this.capacity;
    }
    return result;
  }

  /**
   * 判断是否包含某个元素
   * @param {any} elem - 要查询的元素
   * @returns {boolean}
   */
  includes(elem) {
    let index = this.head;
    while (index !== this.tail) {
      if (this.elements[index] === elem) return true;
      index = (index + 1) % this.capacity;
    }
    return false;
  }

  /**
   * 动态扩容
   * @private
   */
  #resize() {
    const oldCapacity = this.capacity;
    const newCapacity = oldCapacity * Deque.GROWTH_FACTOR;
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

export {
  Deque,
};
