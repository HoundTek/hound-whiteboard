/**
 * @file 日志级别常量
 * @description 定义日志级别枚举和解析工具。
 * @module utils/log/levels
 * @author Zhou Chenyu
 */

/**
 * 日志级别枚举
 * @enum {number}
 */
const LEVELS = {
  /** 调试 - 仅开发环境 */
  DEBUG: 0,
  /** 信息 - 常规运行态 */
  INFO: 1,
  /** 警告 - 非预期但可恢复 */
  WARN: 2,
  /** 错误 - 需关注 */
  ERROR: 3,
  /** 静默 - 关闭所有日志 */
  SILENT: 4,
};

/**
 * 级别名称 → 级别值 映射
 * @type {Record<string, number>}
 */
const LEVEL_NAME_TO_VALUE = Object.fromEntries(
  Object.entries(LEVELS).map(([k, v]) => [k, v]),
);

/**
 * 从字符串获取级别值
 *
 * @param {string} name - 级别名称
 * @param {number} [fallback=LEVELS.INFO] - 兜底值
 * @returns {number}
 *
 * @example
 * resolveLevel("DEBUG"); // => 0
 * resolveLevel("warn");  // => 2（忽略大小写）
 * resolveLevel("UNKNOWN", LEVELS.ERROR); // => 3（用 fallback）
 */
function resolveLevel(name, fallback = LEVELS.INFO) {
  const value = LEVEL_NAME_TO_VALUE[name?.toUpperCase()];
  return value !== undefined ? value : fallback;
}

export { LEVELS, resolveLevel };
