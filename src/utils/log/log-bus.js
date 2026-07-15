/**
 * @file 日志总线
 * @description 提供全局日志 EventBus，Logger 发射日志事件，订阅者通过 LogBus 消费。
 * @module utils/log/log-bus
 * @author Zhou Chenyu
 */

import { EventBus } from "../../core/engine/utils/event-bus.js";

/**
 * 日志级别名称数组
 * @type {string[]}
 */
const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"];

/**
 * 日志事件总线
 *
 * @description
 * 以 EventBus 为基础的日志专用总线。
 * Logger 调用 `logBus.emit('INFO', entry)`，订阅者调用 `logBus.on('INFO', handler)`。
 *
 * 支持通配符订阅 `'*'` 接收所有级别。
 *
 * @class
 * @extends EventBus
 *
 * @example
 * const bus = new LogBus();
 * bus.on('ERROR', (entry) => { console.error(entry); });
 * bus.emit('INFO', { timestamp, level:'INFO', logger:'App', args:['started'] });
 */
class LogBus extends EventBus {
  constructor() {
    super();
  }

  /**
   * 发射日志条目
   *
   * @description
   * 同时通知级别特定订阅者和通配符订阅者 `*`。
   * 同步调用所有匹配的监听器。
   *
   * @param {string} level - 日志级别
   * @param {object} entry - 日志条目 { timestamp, level, logger, args, meta }
   * @returns {Array<*>} 所有监听器的返回值
   *
   * @example
   * const bus = new LogBus();
   * bus.on("ERROR", (e) => console.error(e));
   * bus.emit("ERROR", { level: "ERROR", logger: "App", args: ["crash"] });
   */
  emit(level, entry) {
    const results = [];

    if (this.listeners.has(level)) {
      results.push(...super.emit(level, entry));
    }

    if (this.listeners.has("*")) {
      results.push(...super.emit("*", entry));
    }

    return results;
  }

  /**
   * 注册所有级别共用的监听器
   *
   * @param {Function} handler - 接收 entry 对象
   * @returns {Function} 取消订阅函数
   *
   * @example
   * const bus = new LogBus();
   * const off = bus.onAny((entry) => {
   *   console.log(`[${entry.level}] ${entry.logger}:`, ...entry.args);
   * });
   * // 之后可调用 off() 取消订阅
   */
  onAny(handler) {
    return this.on("*", handler);
  }

  /**
   * 订阅指定级别
   *
   * @param {string} level - 级别名
   * @param {Function} handler - 接收 entry 对象
   * @returns {Function} 取消订阅函数
   *
   * @example
   * const bus = new LogBus();
   * bus.onLevel("ERROR", (entry) => {
   *   sendToTelemetry(entry);
   * });
   */
  onLevel(level, handler) {
    return this.on(level, handler);
  }

  /**
   * 订阅多个级别
   *
   * @param {string[]} levels - 级别数组
   * @param {Function} handler - 接收 entry 对象
   * @returns {Function} 取消订阅函数（一次性取消所有）
   *
   * @example
   * const bus = new LogBus();
   * const off = bus.onLevels(["WARN", "ERROR"], (entry) => {
   *   appendToErrorFile(entry);
   * });
   * // 调用 off() 一次性取消 WARN 和 ERROR 两个订阅
   */
  onLevels(levels, handler) {
    const offs = levels.map((l) => this.on(l, handler));
    return () => offs.forEach((off) => off());
  }
}

/**
 * 全局日志总线单例
 * @type {LogBus}
 */
const logBus = new LogBus();

export { LOG_LEVELS, LogBus, logBus };
