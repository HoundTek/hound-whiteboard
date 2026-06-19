/**
 * @file 日志速率追踪器
 * @description 统计每个 Logger 在时间窗口内的发射速率（条/秒）。
 * @module utils/log/rate-tracker
 * @author Zhou Chenyu
 */

/**
 * 日志速率追踪器
 *
 * @description
 * 统计每个 Logger 在时间窗口内的发射速率（条/秒）。
 * 用于仪表盘展示或节流参数调优。
 *
 * @class
 *
 * @example
 * const tracker = new LogRateTracker(1000);
 * const unsub = logBus.onAny((entry) => tracker.record(entry));
 *
 * // 每秒查询
 * setInterval(() => {
 *   console.table(tracker.getRates());
 * }, 1000);
 */
class LogRateTracker {
  /**
   * 统计窗口（ms）
   * @type {number}
   */
  windowMs;

  /** @type {Map<string, number[]>} */
  #logs = new Map();

  /**
   * @param {number} [windowMs=1000] - 统计窗口
   */
  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
  }

  /**
   * 记录一次日志发射
   *
   * @param {object} entry - 日志条目，必须包含 `logger` 和 `timestamp` 字段
   *
   * @example
   * const tracker = new LogRateTracker(1000);
   * tracker.record({ logger: "App", timestamp: Date.now() });
   */
  record(entry) {
    const name = entry.logger;
    const now = entry.timestamp;
    let times = this.#logs.get(name);
    if (!times) {
      times = [];
      this.#logs.set(name, times);
    }
    times.push(now);
  }

  /**
   * 获取所有 Logger 的当前速率
   *
   * @description
   * 返回结果按速率降序排列，方便观察最活跃的 Logger。
   * `rate` 单位为条/秒。窗口外的历史数据被自动清理。
   *
   * @returns {Array<{ name: string, rate: number, total: number }>}
   *   - name: Logger 名称
   *   - rate: 窗口内每秒发射次数（保留一位小数）
   *   - total: 窗口内总条数
   *
   * @example
   * const tracker = new LogRateTracker(1000);
   * tracker.record({ logger: "App", timestamp: Date.now() });
   * tracker.record({ logger: "App", timestamp: Date.now() + 200 });
   * tracker.record({ logger: "Render", timestamp: Date.now() + 300 });
   *
   * const rates = tracker.getRates();
   * // => [{ name: "App", rate: 2, total: 2 },
   * //     { name: "Render", rate: 1, total: 1 }]
   */
  getRates() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const result = [];

    for (const [name, times] of this.#logs) {
      let i = 0;
      while (i < times.length && times[i] < cutoff) i++;
      if (i > 0) times.splice(0, i);

      const rate = times.length / (this.windowMs / 1000);
      result.push({
        name,
        rate: Math.round(rate * 10) / 10,
        total: times.length,
      });
    }

    result.sort((a, b) => b.rate - a.rate);
    return result;
  }

  /**
   * 订阅 LogBus
   *
   * @description
   * 自动将 LogBus 所有级别的日志条目记录到速率统计中。
   *
   * @param {import("./log-bus.js").LogBus} bus - LogBus 实例
   * @returns {Function} 取消订阅函数
   *
   * @example
   * const tracker = new LogRateTracker(1000);
   * const off = tracker.subscribe(logBus);
   * // 一段时间后
   * off();  // 停止追踪
   */
  subscribe(bus) {
    return bus.onAny((entry) => this.record(entry));
  }

  /**
   * 清空所有统计数据
   *
   * @description
   * 清除所有 Logger 的速率记录。`getRates()` 将返回空数组，直到有新记录。
   *
   * @example
   * const tracker = new LogRateTracker(1000);
   * tracker.record({ logger: "App", timestamp: Date.now() });
   * tracker.clear();
   * tracker.getRates();  // => []
   */
  clear() {
    this.#logs.clear();
  }
}

export { LogRateTracker };
