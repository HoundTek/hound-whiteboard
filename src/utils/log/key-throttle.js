/**
 * @file Key 级别节流器
 * @description 相同 key 的日志在时间窗口内只发射一次，适用于重复告警。
 * @module utils/log/key-throttle
 * @author Zhou Chenyu
 */

/**
 * Key 级节流器
 *
 * @description
 * 对相同 key 的日志，在时间窗口内只发射一次。
 * 适用于重复告警（如 "Chunk X not found" 每帧报一次但只需记一次）。
 *
 * @class
 *
 * @example
 * const throttle = new KeyThrottle(200);
 * if (throttle.tryEmit('chunk-miss')) { /* 记录日志 *\/ }
 */
class KeyThrottle {
  /**
   * 默认窗口（ms）
   * @type {number}
   */
  defaultWindow;

  /** @type {Map<string, { time: number, skipCount: number }>} */
  #states = new Map();

  /**
   * @param {number} [defaultWindow=200] - 默认节流窗口（ms）
   */
  constructor(defaultWindow = 200) {
    this.defaultWindow = defaultWindow;
  }

  /**
   * 检查 key 是否在节流窗口内
   *
   * @param {string} key - 节流 key
   * @param {number} [windowMs] - 可选的窗口覆盖，默认使用构造时的 `defaultWindow`
   * @returns {boolean} true=应放行, false=应丢弃
   *
   * @example
   * const throttle = new KeyThrottle(200);
   *
   * throttle.tryEmit("chunk-miss");  // => true（首次放行）
   * throttle.tryEmit("chunk-miss");  // => false（200ms 内被节流）
   *
   * // 不同 key 独立计费
   * throttle.tryEmit("disk-full");    // => true（不同 key，互不影响）
   *
   * // 覆盖窗口
   * throttle.tryEmit("ping", 5000);   // => true（使用 5s 窗口）
   */
  tryEmit(key, windowMs) {
    const now = Date.now();
    const state = this.#states.get(key);
    const window = windowMs ?? this.defaultWindow;

    if (!state || now - state.time >= window) {
      this.#states.set(key, { time: now, skipCount: 0 });
      return true;
    }

    state.skipCount++;
    return false;
  }

  /**
   * 获取 key 被跳过的次数（自上次发射以来）
   *
   * @param {string} key
   * @returns {number} 跳过次数，未记录过时返回 0
   *
   * @example
   * const throttle = new KeyThrottle(100);
   * throttle.tryEmit("k");           // true
   * throttle.tryEmit("k");           // false
   * throttle.tryEmit("k");           // false
   * throttle.skipCount("k");         // => 2
   * throttle.skipCount("unknown");   // => 0
   */
  skipCount(key) {
    return this.#states.get(key)?.skipCount ?? 0;
  }

  /**
   * 清空所有状态
   *
   * @description
   * 清除所有 key 的计时和计数。清空后所有 key 恢复可放行状态。
   *
   * @example
   * const throttle = new KeyThrottle(200);
   * throttle.tryEmit("a");            // true
   * throttle.tryEmit("b");            // true
   * throttle.clear();
   * throttle.tryEmit("a");            // true（清空后重置）
   */
  clear() {
    this.#states.clear();
  }
}

export { KeyThrottle };
