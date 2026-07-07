/**
 * @file 修饰节点内部工具方法
 * @description 提供修饰节点 handler 内部通用的判断、浅克隆等辅助逻辑。
 *   `isPlainObject` 从 devices-dag 导入以避免重复定义。
 * @module core/ui/devices-dag/prefixs/utils
 * @author Zhou Chenyu
 */

import { isPlainObject } from "../index.js";

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
