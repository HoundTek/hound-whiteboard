/**
 * @file 节流缓冲总线
 * @description 作为 LogBus 和重量级消费者之间的缓冲层，攒批后异步刷出。
 * @module utils/log/throttled-bus
 * @author Zhou Chenyu
 */

/**
 * ThrottledBus 配置项
 * @typedef {object} ThrottledBusOptions
 * @property {number} [flushInterval=500] - 定时刷盘间隔（ms）
 * @property {number} [maxBufferSize=200] - 缓冲区上限（条数）
 * @property {Function} onFlush - 刷盘回调，接收 `entry[]` 数组
 */

/**
 * 节流缓冲总线
 *
 * @description
 * 将收到的日志条目攒批，定时或满额后刷给消费者。
 * 适用于文件写入、UI 面板更新、网络推送等场景。
 *
 * @class
 *
 * @example
 * const fileWriter = new ThrottledBus({
 *   flushInterval: 1000,
 *   maxBufferSize: 100,
 *   onFlush: (batch) => appendFile('hwb.log', batch.map(JSON.stringify).join('\n')),
 * });
 * const unsub = logBus.onAny((entry) => fileWriter.write(entry));
 */
class ThrottledBus {
  /**
   * 刷盘间隔（ms）
   * @type {number}
   */
  flushInterval;

  /**
   * 最大缓冲条目
   * @type {number}
   */
  maxBufferSize;

  /** @type {object[]} */
  #buffer;

  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer;

  /** @type {Function} */
  #onFlush;

  /**
   * 统计信息
   * @type {{ received: number, flushed: number, dropped: number }}
   */
  stats;

  /**
   * @param {ThrottledBusOptions} options
   */
  constructor(options = {}) {
    this.flushInterval = options.flushInterval ?? 500;
    this.maxBufferSize = options.maxBufferSize ?? 200;
    this.#onFlush = options.onFlush;
    this.#buffer = [];
    this.#timer = null;
    this.stats = { received: 0, flushed: 0, dropped: 0 };
  }

  /**
   * 写入一条日志条目
   *
   * @description
   * 将 entry 加入缓冲区。若缓冲区满则丢弃并计数。
   * 首次写入自动启动定时器，满额立即触发刷出。
   *
   * @param {object} entry - 日志条目
   *
   * @example
   * const bus = new ThrottledBus({ flushInterval: 500, maxBufferSize: 100, onFlush });
   * bus.write({ level: "INFO", logger: "App", args: ["hello"] });
   */
  write(entry) {
    if (typeof this.#onFlush !== "function") return;

    this.stats.received++;

    if (this.#buffer.length >= this.maxBufferSize) {
      this.stats.dropped++;
      return;
    }

    this.#buffer.push(entry);

    if (this.#buffer.length >= this.maxBufferSize) {
      this.#flush();
      return;
    }

    if (!this.#timer) {
      this.#timer = setTimeout(() => this.#flush(), this.flushInterval);
    }
  }

  /**
   * 订阅 LogBus 并自动写入
   *
   * @description
   * 将 LogBus 产生的日志条目自动写入此缓冲区。
   * 可指定级别，不指定则接收所有级别。
   *
   * @param {import("./log-bus.js").LogBus} bus - LogBus 实例
   * @param {string[]} [levels] - 监听的级别，默认所有
   * @returns {Function} 取消订阅函数
   *
   * @example
   * const fileBus = new ThrottledBus({ flushInterval: 1000, onFlush });
   * fileBus.subscribe(logBus);              // 所有级别
   * fileBus.subscribe(logBus, ["ERROR"]);   // 仅 ERROR
   */
  subscribe(bus, levels) {
    if (levels && levels.length > 0) {
      return bus.onLevels(levels, (entry) => this.write(entry));
    }
    return bus.onAny((entry) => this.write(entry));
  }

  /**
   * 立即刷出缓冲区
   *
   * @description
   * 无视 flushInterval 的定时器，立即将当前缓冲区内容全部刷出。
   * 刷出后清空缓冲区并清除定时器。
   *
   * @returns {object[]|undefined} 被刷出的条目数组，缓存区为空时返回 undefined
   *
   * @example
   * const bus = new ThrottledBus({ flushInterval: 5000, onFlush });
   * bus.write({ msg: "urgent" });
   * bus.flush();  // 立即触发 onFlush，不等 5s
   */
  flush() {
    return this.#flush();
  }

  /**
   * 内部刷盘
   * @returns {object[]|undefined}
   */
  #flush() {
    if (this.#buffer.length === 0) return;

    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    const batch = this.#buffer.splice(0);
    this.stats.flushed += batch.length;

    try {
      this.#onFlush(batch);
    } catch (e) {
      console.error("[ThrottledBus] onFlush error:", e);
    }

    return batch;
  }

  /**
   * 关闭：刷出剩余条目并清理定时器
   *
   * @description
   * 清除定时器并最后刷出一次。应用关闭前应调用此方法确保所有日志落盘。
   *
   * @returns {object[]|undefined} 最后一批被刷出的条目
   *
   * @example
   * const bus = new ThrottledBus({ flushInterval: 5000, onFlush });
   * bus.write({ msg: "last log" });
   * bus.shutdown();  // 立即刷出，不等定时器
   */
  shutdown() {
    return this.#flush();
  }
}

export { ThrottledBus };
