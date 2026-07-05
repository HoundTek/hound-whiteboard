/**
 * @file Benchmark 通用辅助函数
 * @description 提供统一的测量、格式化与输出函数，供所有 benchmark 使用。
 * @module benchmarks/helpers
 */

/**
 * 格式化性能测试输出行（与 benchmark 库风格一致）
 * @param {string} label - 测试名称
 * @param {number} opsPerSec - 每秒操作数
 * @param {number} variationPct - 变异系数百分比
 * @param {number} totalRuns - 总运行次数
 * @returns {string} 格式化字符串
 */
export function formatResult(label, opsPerSec, variationPct, totalRuns) {
  return `${label} x ${Math.round(opsPerSec).toLocaleString("en-US")} ops/sec ±${variationPct.toFixed(2)}% (${totalRuns.toLocaleString("en-US")} runs sampled)`;
}

/**
 * 打印性能测试输出行
 * @param {string} label - 测试名称
 * @param {number} opsPerSec - 每秒操作数
 * @param {number} variationPct - 变异系数百分比
 * @param {number} totalRuns - 总运行次数
 */
export function printResult(label, opsPerSec, variationPct, totalRuns) {
  console.log(formatResult(label, opsPerSec, variationPct, totalRuns));
}

/**
 * 打印统一的 section 头部
 * @param {string} title - 测试标题
 */
export function printHeader(title) {
  console.log(`开始 ${title}...\n`);
  console.log("═══════════════════════════════════════════════════\n");
}

/**
 * 打印统一的 section 底部
 */
export function printFooter() {
  console.log("\n" + "═".repeat(55));
}

/**
 * 运行一轮同步 benchmark，计算 ops/sec
 * @param {number} iterations - 本轮迭代次数
 * @param {() => void} fn - 被测同步函数
 * @returns {number} ops/sec
 */
function runSyncRound(iterations, fn) {
  // 预热
  for (let i = 0; i < 50; i++) {
    fn();
  }
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  return iterations / ((performance.now() - start) / 1000);
}

/**
 * 运行一轮异步 benchmark，计算 ops/sec
 * @param {number} iterations - 本轮迭代次数
 * @param {(i: number) => Promise<void>} fn - 被测异步函数
 * @returns {Promise<number>} ops/sec
 */
async function runAsyncRound(iterations, fn) {
  for (let i = 0; i < 50; i++) {
    await fn(i);
  }
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn(i);
  }
  return iterations / ((performance.now() - start) / 1000);
}

/**
 * 对同步函数执行 benchmark 并打印结果
 * @param {string} label - 测试名称
 * @param {number} iterations - 每轮迭代数
 * @param {number} [rounds=5] - 运行轮数
 * @param {() => void} fn - 被测同步函数
 */
export function benchmarkSync(label, iterations, rounds = 5, fn) {
  const rates = [];
  for (let r = 0; r < rounds; r++) {
    rates.push(runSyncRound(iterations, fn));
  }

  const n = rates.length;
  const mean = rates.reduce((a, b) => a + b, 0) / n;
  const varPct =
    mean > 0
      ? (Math.sqrt(rates.reduce((s, v) => s + (v - mean) ** 2, 0) / n) / mean) *
        100
      : 0;

  printResult(label, mean, varPct, iterations * n);
}

/**
 * 对异步函数执行 benchmark 并打印结果
 * @param {string} label - 测试名称
 * @param {number} iterations - 每轮迭代数
 * @param {number} [rounds=5] - 运行轮数
 * @param {(i: number) => Promise<void>} fn - 被测异步函数
 */
export async function benchmarkAsync(label, iterations, rounds = 5, fn) {
  const rates = [];
  for (let r = 0; r < rounds; r++) {
    rates.push(await runAsyncRound(iterations, fn));
  }

  const n = rates.length;
  const mean = rates.reduce((a, b) => a + b, 0) / n;
  const varPct =
    mean > 0
      ? (Math.sqrt(rates.reduce((s, v) => s + (v - mean) ** 2, 0) / n) / mean) *
        100
      : 0;

  printResult(label, mean, varPct, iterations * n);
}
