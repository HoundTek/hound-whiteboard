/**
 * @file 控制台输出器
 * @description 将 LogBus 的日志条目输出到浏览器 console，带颜色标签和时间戳。
 * @module utils/log/console-printer
 * @author Zhou Chenyu
 */

/**
 * 日志级别 → console 样式色
 * @type {Record<string, string>}
 */
const COLORS = {
  DEBUG: "color:#888;font-weight:normal",
  INFO: "color:#22c;font-weight:bold",
  WARN: "color:#c82;font-weight:bold",
  ERROR: "color:#c22;font-weight:bold",
};

/**
 * 日志级别 → console 方法名
 * @type {Record<string, string>}
 */
const CONSOLE_FN = {
  DEBUG: "log",
  INFO: "log",
  WARN: "warn",
  ERROR: "error",
};

/**
 * 创建默认的 console 输出订阅者
 *
 * @description
 * 将 LogBus 的日志条目输出到浏览器 console。
 * 带颜色标签和时间戳。
 *
 * @param {import("./log-bus.js").LogBus} bus - LogBus 实例
 * @param {object} [options]
 * @param {boolean} [options.timestamps=true] - 是否显示时间戳
 * @param {string[]} [options.levels] - 仅输出指定级别，默认全部
 * @returns {Function} 取消订阅函数
 *
 * @example
 * // 基本用法：输出所有级别，带时间戳
 * const off = createConsolePrinter(logBus, { timestamps: true });
 *
 * // 只输出错误
 * createConsolePrinter(logBus, { timestamps: false, levels: ["ERROR"] });
 *
 * // 取消订阅
 * off();
 *
 * // 控制台输出示例：
 * //   %c12:34:56.789[HWB]                    (蓝色粗体)
 * //   %c12:34:56.790[Viewport:BaseRenderer]    (灰色，DEBUG)
 * //   %c12:34:56.791[safe-io]                 (红色粗体，ERROR)
 */
function createConsolePrinter(bus, options = {}) {
  const { timestamps = true, levels } = options;

  const handler = (entry) => {
    const { level, logger, args } = entry;
    const ts = timestamps
      ? new Date(entry.timestamp).toISOString().slice(11, 23) + " "
      : "";
    const prefix = `%c${ts}[${logger}]`;
    const style = COLORS[level] ?? "color:inherit";

    // 所有参数均为字符串时嵌入到 %c 消息中，避免 Chrome 对 string 类型显示 \" 转义
    const allStrings = args.every((a) => typeof a === "string");
    if (allStrings) {
      console[CONSOLE_FN[level] ?? "log"](`${prefix} ${args.join(" ")}`, style);
    } else {
      console[CONSOLE_FN[level] ?? "log"](prefix, style, ...args);
    }
  };

  if (levels && levels.length > 0) {
    return bus.onLevels(levels, handler);
  }
  return bus.onAny(handler);
}

export { createConsolePrinter };
