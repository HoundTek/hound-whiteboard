/**
 * @file 自适应采样器
 * @description 突发密集日志时自动降采样，稀松日志不受影响。
 * @module utils/log/adaptive-sampler
 * @author Zhou Chenyu
 */

/**
 * 自适应采样器
 *
 * @description
 * 距上次日志不足 `minGapMs` 时按衰减采样率决定是否放行，
 * 超过 `minGapMs` 后恢复 100% 采样。
 *
 * @class
 *
 * @example
 * const sampler = new AdaptiveSampler(10, 0.05);
 * if (sampler.sample()) { /* 记录日志 *\/ }
 */
class AdaptiveSampler {
  /**
   * 最小间隔（ms），低于此值触发降采样
   * @type {number}
   */
  minGapMs;

  /**
   * 最低采样率（0~1），为 0 时突发日志全丢弃
   * @type {number}
   */
  minRate;

  /** @type {number | null} */
  #lastTime = null;

  /** @type {number} */
  #skipCount = 0;

  /**
   * @param {number} [minGapMs=10] - 最小间隔
   * @param {number} [minRate=0.05] - 最低采样率
   */
  constructor(minGapMs = 10, minRate = 0.05) {
    this.minGapMs = minGapMs;
    this.minRate = minRate;
  }

  /**
   * 判断当前日志是否应该被记录
   *
   * @returns {boolean} true=放行
   *
   * @example
   * const sampler = new AdaptiveSampler(10, 0.2);
   *
   * // 慢速调用——每次都放行
   * sampler.sample(); // => true
   *
   * // 密集调用——部分被丢弃
   * let passed = 0;
   * for (let i = 0; i < 100; i++) {
   *   if (sampler.sample()) passed++;
   * }
   * // passed ≈ 20~50（取决于随机数）
   */
  sample() {
    const now = Date.now();
    const gap = now - this.#lastTime;

    // 首次调用或间隔足够，恢复满采样
    if (this.#lastTime === null || gap >= this.minGapMs) {
      this.#skipCount = 0;
      this.#lastTime = now;
      return true;
    }

    // 高频突发：按衰减采样率决定
    this.#skipCount++;
    const rate = Math.max(this.minRate, 1 / (this.#skipCount + 1));

    if (Math.random() < rate) {
      this.#lastTime = now;
      return true;
    }

    return false;
  }

  /**
   * 重置采样器状态
   *
   * @description
   * 将内部计数器归零。重置后下一次 `sample()` 必定放行。
   *
   * @example
   * const sampler = new AdaptiveSampler(5, 0);
   * sampler.sample();            // true（首次）
   * sampler.sample();            // false（密集采样被丢弃）
   * sampler.reset();
   * sampler.sample();            // true（重置后恢复）
   */
  reset() {
    this.#lastTime = null;
    this.#skipCount = 0;
  }
}

export { AdaptiveSampler };
