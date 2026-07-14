/**
 * @file 手势工具信号类型与工具函数
 * @description 从 gesture-tool.js 中提取的信号类型常量和同步/异步统一处理函数。
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

/**
 * 手势工具相关信号类型常量
 * @readonly
 * @enum {string}
 */
const GESTURE_TOOL_SIGNAL_TYPES = Object.freeze({
  /** 世界坐标位置更新 */
  POSITION: "position",
  /** 手势结束 */
  GESTURE_END: "end",
  /** 手势取消 */
  GESTURE_CANCEL: "cancel",
  /** 多手势对象结束 */
  OBJECT_END: "object-end",
  /** 多手势对象取消 */
  OBJECT_CANCEL: "object-cancel",
  /** 显式提交动作 */
  SUCCESS: "success",
  /** 外部强制结束动作（如 tool-switcher 切换） */
  END_ACTION: "end-action",
});

export { GESTURE_TOOL_SIGNAL_TYPES, unifyActionResult };
