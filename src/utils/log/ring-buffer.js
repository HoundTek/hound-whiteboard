/**
 * @file 环形缓冲区
 * @description 固定大小的环形缓冲区，始终保留最近的 N 条日志条目，用于崩溃事后分析。
 * @module utils/log/ring-buffer
 * @author Zhou Chenyu
 */

/**
 * 环形缓冲区
 *
 * @description
 * 固定大小的环形缓冲区，始终保留最近的 N 条日志条目。
 * 不节流、不降采样，用于崩溃事后分析。
 * 可挂在 LogBus 上接收所有级别。
 *
 * @class
 *
 * @example
 * const ring = new RingBuffer(500);
 * const unsub = logBus.onAny((entry) => ring.push(entry));
 *
 * // 崩溃时导出
 * const recentLogs = ring.dump();
 */
class RingBuffer {
  /**
   * 缓冲区大小
   * @type {number}
   */
  size;

  /** @type {number} */
  #head = 0;

  /** @type {number} */
  #count = 0;

  /** @type {any[]} */
  #buffer;

  /**
   * @param {number} [size=500] - 缓冲区大小
   */
  constructor(size = 500) {
    this.size = size;
    this.#buffer = new Array(size);
  }

  /**
   * 写入一条日志
   *
   * @description
   * 写入到当前 head 位置，然后将 head 前移。
   * 缓冲区满时自动覆盖最旧的条目。
   *
   * @param {object} entry - 日志条目
   *
   * @example
   * const ring = new RingBuffer(3);
   * ring.push({ msg: "a" });
   * ring.push({ msg: "b" });
   * ring.push({ msg: "c" });
   * ring.push({ msg: "d" });  // 覆盖了 "a"
   * ring.dump();  // => [{ msg: "b" }, { msg: "c" }, { msg: "d" }]
   */
  push(entry) {
    this.#buffer[this.#head] = entry;
    this.#head = (this.#head + 1) % this.size;
    this.#count++;
  }

  /**
   * 获取当前缓冲区有效条目数
   *
   * @returns {number} 不会超过构造函数传入的 `size`
   *
   * @example
   * const ring = new RingBuffer(3);
   * ring.length;          // => 0
   * ring.push({ i: 1 });
   * ring.length;          // => 1
   * ring.push({ i: 2 });
   * ring.push({ i: 3 });
   * ring.push({ i: 4 });  // 覆盖了第 1 条
   * ring.length;          // => 3（不超过 size）
   */
  get length() {
    return Math.min(this.#count, this.size);
  }

  /**
   * 获取自创建以来的累计写入总次数（含已被覆盖的）
   *
   * @returns {number}
   *
   * @example
   * const ring = new RingBuffer(3);
   * for (let i = 0; i < 10; i++) ring.push({ i });
   * ring.totalPushed;  // => 10
   * ring.length;       // => 3（只保留最近的 3 条）
   */
  get totalPushed() {
    return this.#count;
  }

  /**
   * 按时间顺序导出所有有效条目
   *
   * @returns {object[]} 从最旧到最新的有序数组。缓冲区为空时返回 `[]`。
   *
   * @example
   * const ring = new RingBuffer(4);
   * ring.push({ i: 1 });
   * ring.push({ i: 2 });
   * ring.push({ i: 3 });
   * ring.dump();  // => [{ i: 1 }, { i: 2 }, { i: 3 }]
   *
   * // 绕圈后仍然按时间顺序
   * ring.push({ i: 4 });
   * ring.push({ i: 5 });  // 覆盖了 { i: 1 }
   * ring.dump();  // => [{ i: 2 }, { i: 3 }, { i: 4 }, { i: 5 }]
   */
  dump() {
    const len = this.length;
    if (len === 0) return [];

    const result = new Array(len);
    const start = this.#count < this.size ? 0 : this.#head;
    for (let i = 0; i < len; i++) {
      result[i] = this.#buffer[(start + i) % this.size];
    }
    return result;
  }

  /**
   * 按级别筛选导出
   *
   * @param {string|string[]} levels - 级别名（如 `"ERROR"`）或数组（如 `["WARN", "ERROR"]`）
   * @returns {object[]} 仅包含匹配级别的条目，按时间顺序
   *
   * @example
   * const ring = new RingBuffer(10);
   * ring.push({ level: "INFO", msg: "ok" });
   * ring.push({ level: "ERROR", msg: "fail" });
   * ring.push({ level: "WARN", msg: "caution" });
   *
   * ring.dumpByLevel("ERROR");        // => [{ level: "ERROR", msg: "fail" }]
   * ring.dumpByLevel(["WARN", "ERROR"]); // => 2 条
   */
  dumpByLevel(levels) {
    const set = Array.isArray(levels) ? new Set(levels) : new Set([levels]);
    return this.dump().filter((e) => e && set.has(e.level));
  }

  /**
   * 订阅 LogBus 并自动写入
   *
   * @description
   * 将 LogBus 产生的日志条目自动写入环形缓冲区。
   * 可指定级别，不指定则接收所有级别。
   *
   * @param {import("./log-bus.js").LogBus} bus - LogBus 实例
   * @param {string[]} [levels] - 监听的级别，默认所有
   * @returns {Function} 取消订阅函数
   *
   * @example
   * const ring = new RingBuffer(1000);
   * ring.subscribe(logBus);               // 接收所有级别
   * ring.subscribe(logBus, ["ERROR"]);    // 只保留 ERROR
   */
  subscribe(bus, levels) {
    if (levels && levels.length > 0) {
      return bus.onLevels(levels, (entry) => this.push(entry));
    }
    return bus.onAny((entry) => this.push(entry));
  }

  /**
   * 清空缓冲区
   *
   * @description
   * 重置所有内部状态，`length` 归零，`totalPushed` 不受影响。
   *
   * @example
   * const ring = new RingBuffer(5);
   * ring.push({ msg: "temp" });
   * ring.clear();
   * ring.length;  // => 0
   * ring.dump();  // => []
   */
  clear() {
    this.#buffer = new Array(this.size);
    this.#head = 0;
    this.#count = 0;
  }
}

export { RingBuffer };
