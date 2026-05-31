/**
 * @file 修饰节点信号常量
 * @module core/prefixs/constants
 * @author Zhou Chenyu
 */

/**
 * 修饰节点常用信号类型
 * @readonly
 * @enum {string}
 * @description
 * 定义修饰节点侧仍保留的兼容信号类型。
 * 当前内置 handoff 与多工具状态机已经优先改用累积 context 中的回调，
 * 这些常量主要用于旧链路兼容和少量显式信号协议。
 */
const PREFIX_NODE_SIGNAL_TYPES = Object.freeze({
  /** 子工具已完成当前任务的兼容完成信号 */
  TOOL_COMPLETE: "tool:complete",
  /** repeator 修饰节点已完成信号复制分发 */
  REPEATOR_DUPLICATE_SIGNAL: "repeator:duplicate",
});

export { PREFIX_NODE_SIGNAL_TYPES };
