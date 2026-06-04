/**
 * @file 修饰节点内部工具方法
 * @description 提供修饰节点 handler 内部通用的纯对象判断、浅克隆等辅助逻辑。不对外暴露给消费者直接使用。
 * @module core/prefixs/utils
 * @author Zhou Chenyu
 */

/**
 * 判断值是否为纯对象
 * @param {any} value - 待判断值
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * 浅克隆信号列表，避免下游修改时相互干扰
 * @param {Array<Object>} [signals=[]] - 原始信号列表
 * @returns {Array<Object>}
 */
function shallowCloneSignals(signals = []) {
  if (!Array.isArray(signals)) return [];
  return signals.map((signal) =>
    signal && typeof signal === "object" ? { ...signal } : signal,
  );
}

export { isPlainObject, shallowCloneSignals };
