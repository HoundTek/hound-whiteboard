/**
 * @file Core 事件总线
 * @description 提供同步事件订阅、取消订阅和单次订阅能力。
 * @module core/engine/utils/event-bus
 * @author Zhou Chenyu
 */

/**
 * 事件总线
 * @template T
 * @class
 * @description 提供同步事件订阅、取消订阅和单次订阅能力。
 */
class EventBus {
  /**
   * 事件监听器表
   * @type {Map<string, Set<Function>>}
   */
  listeners;

  constructor() {
    this.listeners = new Map();
  }

  /**
   * 订阅事件
   * @template H
   * @param {string} eventName - 事件名
   * @param {(payload: T) => H} handler - 监听器
   * @returns {Function} 取消订阅函数
   */
  on(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }

  /**
   * 取消订阅事件
   * @param {string} eventName - 事件名
   * @param {Function} handler - 监听器
   * @returns {boolean} 是否成功移除
   */
  off(eventName, handler) {
    if (!this.listeners.has(eventName)) return false;
    const removed = this.listeners.get(eventName).delete(handler);
    if (this.listeners.get(eventName).size === 0) {
      this.listeners.delete(eventName);
    }
    return removed;
  }

  /**
   * 订阅一次事件
   * @template H
   * @param {string} eventName - 事件名
   * @param {(payload: T) => H} handler - 监听器
   * @returns {Function} 取消订阅函数
   */
  once(eventName, handler) {
    const onceHandler = (payload) => {
      this.off(eventName, onceHandler);
      return handler(payload);
    };
    return this.on(eventName, onceHandler);
  }

  /**
   * 发射事件
   * @template H
   * @param {string} eventName - 事件名
   * @param {T} payload - 事件数据
   * @returns {Array<H>} 所有监听器返回值
   */
  emit(eventName, payload) {
    if (!this.listeners.has(eventName)) return [];
    const handlers = Array.from(this.listeners.get(eventName));
    return handlers.map((handler) => handler(payload));
  }

  /**
   * 清空指定事件或全部事件
   * @param {string} [eventName] - 事件名
   */
  clear(eventName) {
    if (eventName === undefined) {
      this.listeners.clear();
      return;
    }
    this.listeners.delete(eventName);
  }
}

export {
  EventBus,
};