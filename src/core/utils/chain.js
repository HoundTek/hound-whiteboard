/**
 * 链表
 * @module core/utils/chain
 * @author Zhou Chenyu
 */

/**
 * 链表节点
 * @class
 * @author Zhou Chenyu
 */
class Node {
  /**
   * 节点值
   * @type {any}
   */
  value;

  /**
   * 下一个节点
   * @type {Node|null}
   */
  next;

  /**
   * @constructor
   * @param {any} value - 节点值
   */
  constructor(value) {
    this.value = value;
    this.next = null;
  }
}

/**
 * 链表
 * @author Zhou Chenyu
 */
class Chain {
  /**
   * 链表头节点
   * @type {Node | null}
   */
  head;

  /**
   * 链表尾节点
   * @type {Node | null}
   */
  tail;

  /**
   * 链表长度
   * @type {number}
   */
  length;

  /**
   * @constructor
   */
  constructor() {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  /**
   * 在链表末尾添加一个节点
   * @param {any} value - 要添加的节点值
   */
  append(value) {
    const newNode = new Node(value);
    if (!this.head) {
      this.head = newNode;
      this.tail = newNode;
    } else {
      this.tail.next = newNode;
      this.tail = newNode;
    }
    this.length++;
  }

  /**
   * 在链表开头添加一个节点
   * @param {any} value - 要添加的节点值
   */
  prepend(value) {
    const newNode = new Node(value);
    if (!this.head) {
      this.head = newNode;
      this.tail = newNode;
    } else {
      newNode.next = this.head;
      this.head = newNode;
    }
    this.length++;
  }

  /**
   * 在指定位置插入一个节点
   * @param {any} value - 要插入的节点值
   * @param {number} index - 插入位置的索引
   * @throws {RangeError} 当索引超出范围时
   */
  insertAt(value, index) {
    if (index < 0 || index > this.length) {
      throw new RangeError("Index out of bounds");
    }
    if (index === 0) {
      this.prepend(value);
    } else if (index === this.length) {
      this.append(value);
    } else {
      const newNode = new Node(value);
      let current = this.head;
      let previous = null;
      for (let i = 0; i < index; i++) {
        previous = current;
        current = current.next;
      }
      newNode.next = current;
      previous.next = newNode;
      this.length++;
    }
  }

  /**
   * 移除指定位置的节点
   * @param {number} index - 移除位置的索引
   * @returns {any} 被移除节点的值
   * @throws {RangeError} 当索引超出范围或链表为空时
   */
  removeAt(index) {
    if (index < 0 || index >= this.length || this.isEmpty()) {
      throw new RangeError("Index out of bounds or Chain is empty");
    }
    let removedValue;
    if (index === 0) {
      removedValue = this.head.value;
      this.head = this.head.next;
      if (!this.head) {
        this.tail = null;
      }
    } else {
      let current = this.head;
      let previous = null;
      for (let i = 0; i < index; i++) {
        previous = current;
        current = current.next;
      }
      removedValue = current.value;
      previous.next = current.next;
      if (!current.next) {
        this.tail = previous;
      }
    }
    this.length--;
    return removedValue;
  }

  /**
   * 获取指定位置的节点值
   * @param {number} index - 节点位置的索引
   * @returns {any} 节点值
   * @throws {RangeError} 当索引超出范围或链表为空时
   */
  getAt(index) {
    if (index < 0 || index >= this.length || this.isEmpty()) {
      throw new RangeError("Index out of bounds or Chain is empty");
    }
    let current = this.head;
    for (let i = 0; i < index; i++) {
      current = current.next;
    }
    return current.value;
  }

  /**
   * 获取指定值的节点索引
   * @param {any} value - 要查找的值
   * @returns {number} 节点索引，如果未找到则返回 -1
   */
  indexOf(value) {
    let current = this.head;
    let index = 0;
    while (current) {
      if (current.value === value) {
        return index;
      }
      current = current.next;
      index++;
    }
    return -1;
  }

  /**
   * 检查链表是否为空
   * @returns {boolean} 如果链表为空则返回 true，否则返回 false
   */
  isEmpty() {
    return this.length === 0;
  }

  /**
   * 获取链表长度
   * @returns {number} 链表长度
   */
  size() {
    return this.length;
  }

  /**
   * 清空链表
   */
  clear() {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }
}

export {
  Chain,
  Node,
};
