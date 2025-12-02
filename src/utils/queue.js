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
   * @type {*}
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
	 * @constructor
	 */
  constructor() {
    this.elements = {};
    this.head = 0;
    this.tail = 0;
  }

	/**
	 * 入队
	 * @param {*} elem - 要入队的元素
	 */
  push(elem) {
		this.elements[this.tail] = elem;
		this.tail++;
	}

	/**
	 * 出队
	 * @throws {RangeError} 当队列为空时
	 * @returns {*}
	 */
	pop() {
		if (this.empty()) {
			throw new RangeError("Queue is empty");
		}
		const item = this.elements[this.head];
		delete this.elements[this.head];
		this.head++;
		return item;
	}

	/**
	 * 队列元素个数
	 * @returns {number}
	 */
	count() {
		return this.tail - this.head;
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
	 * @returns {*}
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
		this.elements = {};
		this.head = 0;
		this.tail = 0;
	}
}

module.exports = {
	Queue
}
