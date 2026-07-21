/**
 * @file 共享状态存储
 * @description 提供跨信道会话状态的多写者键值存储与同步订阅通知。
 * @module core/engine/utils/shared-state-store
 * @author Zhou Chenyu
 */

import { Logger } from "../../../utils/log/logger.js";
import { logBus } from "../../../utils/log/log-bus.js";

/**
 * 共享状态存储日志
 * @type {Logger}
 */
const storeLog = new Logger("SharedStateStore", "WARN", logBus);

/**
 * 共享状态变更回调
 * @description 同步在 `set` 调用栈内执行；禁止在回调内同步 dispatch 进设备图；需容忍自己写入的回声。
 * @callback SharedStateChangeCallback
 * @param {*} value - 变更后的新值
 * @param {string} key - 发生变更的状态键
 * @returns {void}
 */

/**
 * 共享状态存储
 * @class
 * @description
 * SharedStateStore 是跨信道会话状态的共享存储，服务于"多个设备与图外 UI
 * 必须达成一致"的场景（如按钮组设备与 DOM 工具栏的高亮一致）。
 * 它是有边界的第四种状态模型，不用于替代信号、services 或节点 state。
 *
 * 语义约束：
 *
 * - **多写者 LWW**：任何写者都可以 `set` 任意键，不做访问控制，最后一次写入获胜（Last-Writer-Wins）
 * - **同步通知**：`set` 在写入后同步调用该键的全部订阅者；值经 `Object.is` 比较相同则跳过写入与通知
 * - **回声容忍**：订阅者会收到自己写入触发的通知（回声），订阅者需自行容忍
 * - **重入禁令**：订阅者禁止在回调内同步 dispatch 进设备图——回调在 `set` 调用栈内同步执行，重入会把 store 通知链与图分发链搅成死循环
 * - **异常隔离**：单个订阅者回调抛错不中断其余订阅者，错误经 log 工具告警
 */
class SharedStateStore {
  /**
   * 键值存储表
   * @type {Map<string, *>}
   */
  #values = new Map();

  /**
   * 订阅者表（键 → 回调集合）
   * @type {Map<string, Set<SharedStateChangeCallback>>}
   */
  #subscribers = new Map();

  /**
   * 读取指定键的当前值
   * @param {string} key - 状态键
   * @returns {*} 当前值，未写入时为 undefined
   */
  get(key) {
    return this.#values.get(key);
  }

  /**
   * 写入指定键的值（LWW）
   * @description
   * 值经 `Object.is` 比较与当前值相同时跳过写入与通知；
   * 否则写入并同步通知该键的全部订阅者 `callback(value, key)`。
   * @param {string} key - 状态键
   * @param {*} value - 新值
   * @returns {void}
   */
  set(key, value) {
    if (Object.is(this.#values.get(key), value)) {
      return;
    }

    this.#values.set(key, value);

    const subscribers = this.#subscribers.get(key);
    if (!subscribers) {
      return;
    }

    for (const callback of Array.from(subscribers)) {
      try {
        callback(value, key);
      } catch (error) {
        storeLog.warn(`subscriber callback for key "${key}" failed:`, error);
      }
    }
  }

  /**
   * 订阅指定键的变更通知
   * @description 通知为同步回调，订阅者会收到自己写入的回声。
   * @param {string} key - 状态键
   * @param {SharedStateChangeCallback} callback - 变更回调
   * @returns {() => void} 退订函数
   */
  subscribe(key, callback) {
    if (!this.#subscribers.has(key)) {
      this.#subscribers.set(key, new Set());
    }
    this.#subscribers.get(key).add(callback);

    return () => {
      const subscribers = this.#subscribers.get(key);
      if (!subscribers) {
        return;
      }
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.#subscribers.delete(key);
      }
    };
  }

  /**
   * 获取全部键值对的浅拷贝快照
   * @description 修改返回的快照不影响存储内部状态。
   * @returns {Object<string, *>} 状态快照
   */
  getSnapshot() {
    return Object.fromEntries(this.#values);
  }
}

export { SharedStateStore };
