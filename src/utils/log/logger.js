/**
 * @file 日志 Logger
 * @description 提供带命名空间、日志级别和自适应采样的 Logger。
 * 所有日志通过 LogBus 发射，由下游订阅者消费。
 * @module utils/log/logger
 * @author Zhou Chenyu
 */

import { LEVELS, resolveLevel } from "./levels.js";
import { AdaptiveSampler } from "./adaptive-sampler.js";
import { KeyThrottle } from "./key-throttle.js";

/**
 * 日志 Logger
 *
 * @class
 * @description
 * 创建带命名空间的 Logger，自动通过 LogBus 发射日志事件。
 * DEBUG 级别默认启用自适应采样。
 *
 * @example
 * const log = new Logger('Viewport', 'INFO', logBus);
 * log.info('Viewport updated', { origin, zoom });
 *
 * const sub = log.child('BaseRenderer');
 * sub.warn('Chunk not found', chunkId);
 *
 * // 源头节流（相同 key 200ms 内不重复）
 * log.throttledWarn('chunk-miss', 'Chunk not found', chunkId);
 */
class Logger {
  /**
   * Logger 名称
   * @type {string}
   */
  name;

  /**
   * 当前日志级别值
   * @type {number}
   */
  level;

  /**
   * LogBus 实例
   * @type {import("./log-bus.js").LogBus}
   */
  bus;

  /**
   * 自适应采样器（DEBUG 级别）
   * @type {AdaptiveSampler}
   */
  #sampler;

  /**
   * 源头节流器
   * @type {KeyThrottle}
   */
  #keyThrottle;

  /**
   * 元数据（继承链用 _ 前缀，允许 child 访问）
   * @type {object}
   */
  _meta;

  /**
   * @param {string} name - Logger 命名空间（如 "Viewport", "HWB"）
   * @param {number|string} [level=LEVELS.INFO] - 日志级别，支持字符串名或 LEVELS 值
   * @param {import("./log-bus.js").LogBus} [bus] - LogBus 实例，不传时 fallback 到原生 console
   *
   * @example
   * const log = new Logger("App", "INFO", logBus);
   * log.info("App started");
   *
   * // 无 LogBus 时自动降级到 console
   * const fallback = new Logger("Temp", "DEBUG");
   * fallback.warn("no bus — goes to console directly");
   */
  constructor(name, level = LEVELS.INFO, bus) {
    this.name = name;
    this.level = typeof level === "string" ? resolveLevel(level) : level;
    this.bus = bus ?? null;
    this.#sampler = new AdaptiveSampler();
    this.#keyThrottle = new KeyThrottle();
    this._meta = {};
  }

  /**
   * 设置 LogBus
   *
   * @param {import("./log-bus.js").LogBus} bus
   *
   * @example
   * const log = new Logger("App", "INFO");
   * // 延迟挂载 LogBus
   * log.setBus(logBus);
   * log.info("now connected to bus");
   */
  setBus(bus) {
    this.bus = bus;
  }

  /**
   * 设置日志级别（支持字符串或数值）
   *
   * @param {number|string} level
   *
   * @example
   * const log = new Logger("App", "INFO", logBus);
   * log.setLevel("WARN");        // 只保留 WARN 以上
   * log.setLevel(LEVELS.DEBUG);  // 打开所有级别
   */
  setLevel(level) {
    this.level = typeof level === "string" ? resolveLevel(level) : level;
  }

  /**
   * 调试日志
   *
   * @description
   * 仅在 `level ≤ DEBUG` 时输出。高频调用时会自动降采样。
   *
   * @param {...any} args
   *
   * @example
   * log.debug("Dirty rects:", rects);
   * log.debug("Frame", frameId, "objects", count);
   */
  debug(...args) {
    if (this.level > LEVELS.DEBUG) return;
    if (!this.#sampler.sample()) return;
    this.#emit("DEBUG", args);
  }

  /**
   * 信息日志
   *
   * @description
   * 常规运行态信息。仅在 `level ≤ INFO` 时输出。
   *
   * @param {...any} args
   *
   * @example
   * log.info("Application initialized");
   * log.info("Viewport updated", { origin: [0, 0], zoom: 1 });
   */
  info(...args) {
    if (this.level > LEVELS.INFO) return;
    this.#emit("INFO", args);
  }

  /**
   * 警告日志
   *
   * @description
   * 非预期但可恢复的情况。仅在 `level ≤ WARN` 时输出。
   *
   * @param {...any} args
   *
   * @example
   * log.warn("Configuration key missing, using default");
   * log.warn("Chunk %d not found, skipping", chunkId);
   */
  warn(...args) {
    if (this.level > LEVELS.WARN) return;
    this.#emit("WARN", args);
  }

  /**
   * 错误日志
   *
   * @description
   * 需关注的问题。仅在 `level ≤ ERROR` 时输出。
   *
   * @param {...any} args
   *
   * @example
   * log.error("Failed to load file:", err);
   * log.error("IPC invoke failed", command, error);
   */
  error(...args) {
    if (this.level > LEVELS.ERROR) return;
    this.#emit("ERROR", args);
  }

  /**
   * 节流后的警告（相同 key 在窗口内只发一次）
   *
   * @description
   * 适用于渲染循环中每帧都报的同类告警。默认窗口 200ms。
   *
   * @param {string} key - 节流 key
   * @param {...any} args
   *
   * @example
   * // 每帧报一次，但 200ms 内只记第一条
   * log.throttledWarn("chunk-miss", `Chunk ${id} not found`);
   */
  throttledWarn(key, ...args) {
    if (this.level > LEVELS.WARN) return;
    if (!this.#keyThrottle.tryEmit(key)) return;
    this.#emit("WARN", args, { throttled: true, throttleKey: key });
  }

  /**
   * 节流后的信息
   *
   * @description
   * 适用于高频同类信息，默认窗口 200ms。
   *
   * @param {string} key - 节流 key
   * @param {...any} args
   *
   * @example
   * log.throttledInfo("buffer-sync", "Buffer synced, chunks=%d", n);
   */
  throttledInfo(key, ...args) {
    if (this.level > LEVELS.INFO) return;
    if (!this.#keyThrottle.tryEmit(key)) return;
    this.#emit("INFO", args, { throttled: true, throttleKey: key });
  }

  /**
   * 节流后的错误
   *
   * @description
   * 适用于高频同类错误，默认窗口 200ms。
   *
   * @param {string} key - 节流 key
   * @param {...any} args
   *
   * @example
   * log.throttledError("disk-full", "No space left on device");
   */
  throttledError(key, ...args) {
    if (this.level > LEVELS.ERROR) return;
    if (!this.#keyThrottle.tryEmit(key)) return;
    this.#emit("ERROR", args, { throttled: true, throttleKey: key });
  }

  /**
   * 创建子 Logger（继承命名空间和级别）
   *
   * @description
   * 子 Logger 的命名空间自动拼接为 `parent:child` 格式。
   * 继承父 Logger 的日志级别和 LogBus。
   *
   * @param {string} subName - 子名称
   * @param {object} [extraMeta] - 附加元数据，会与父 meta 合并
   * @returns {Logger} 新的子 Logger 实例
   *
   * @example
   * const root = new Logger("App", "DEBUG", logBus);
   * const renderLog = root.child("Renderer");
   * renderLog.info("canvas ready");
   * // logger 名: "App:Renderer"
   *
   * // 带额外上下文
   * const chunkLog = root.child("Chunk", { chunkId: 5 });
   * chunkLog.warn("not found");
   * // entry.meta.chunkId === 5
   */
  child(subName, extraMeta) {
    const child = new Logger(`${this.name}:${subName}`, this.level, this.bus);
    child._meta = { ...this._meta, ...extraMeta };
    return child;
  }

  /**
   * 重置采样器状态
   *
   * @description
   * 将内部 AdaptiveSampler 重置，使下一次 `debug()` 调用必定放行。
   * 通常不需要手动调用，主要用于测试。
   *
   * @example
   * log.resetSampler();
   * log.debug("this will always pass");
   */
  resetSampler() {
    this.#sampler.reset();
  }

  /**
   * 内部发射日志事件
   * @param {string} level - 级别名称
   * @param {any[]} args - 日志消息/数据
   * @param {object} [extra] - 附加字段
   */
  #emit(level, args, extra) {
    if (!this.bus) {
      this.#consoleFallback(level, args);
      return;
    }

    const entry = {
      timestamp: Date.now(),
      level,
      logger: this.name,
      args,
      meta: { ...this._meta, ...extra },
    };

    this.bus.emit(level, entry);
  }

  /**
   * 兜底到 console
   * @param {string} level
   * @param {any[]} args
   */
  #consoleFallback(level, args) {
    const prefix = `[${this.name}]`;
    const fn = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log";
    console[fn](prefix, ...args);
  }
}

export { Logger };
