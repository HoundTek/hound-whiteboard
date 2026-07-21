/**
 * @file 手势工具函数
 * @description 提供同步/异步动作结果的统一处理函数。
 * @module core/ui-thread/devices-dag/tools/gesture-signal-types
 * @author Zhou Chenyu
 */

/**
 * 统一处理可能同步或异步的动作结果（纯函数）
 * @description
 * 同步结果立即调用回调并同步返回；Promise 则链式 then 回调并返回新 Promise。
 * 执行时序完全由结果类型决定，不引入额外 microtask。
 * @template T, U
 * @param {T|Promise<T>} result - 可能同步可能异步的返回值
 * @param {(value: T) => U} onResolved - 结果就绪后的回调
 * @returns {U|Promise<U>} 保持原返回值类型（sync→sync, async→async）
 */
function unifyActionResult(result, onResolved) {
  if (result instanceof Promise) {
    return result.then(onResolved);
  }
  return onResolved(result);
}

export { unifyActionResult };
