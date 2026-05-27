/**
 * @file 修饰节点信号常量
 * @module core/prefix/constants
 * @author Zhou Chenyu
 */

/**
 * 修饰节点常用信号类型
 * @readonly
 * @enum {string}
 * @description 定义修饰节点与子节点之间约定的信号类型。子节点可通过返回这些信号来触发修饰节点的状态切换或复制流程。
 */
const PREFIX_NODE_SIGNAL_TYPES = Object.freeze({
  /** 子工具已完成当前任务，可触发多工具修饰节点的状态机切换 */
  TOOL_COMPLETE: "tool:complete",
  /** repeator 修饰节点已完成信号复制分发 */
  REPEATOR_DUPLICATE_SIGNAL: "repeator:duplicate",
});

export { PREFIX_NODE_SIGNAL_TYPES };
