/**
 * @file 工具切换助手
 * @description 提供「校验 + 写共享状态 store + 产出 tool-switch 信号」的纯函数接口。
 * @module core/ui-thread/devices-dag/tools/switch-tool
 * @author Zhou Chenyu
 */

import { SIGNAL_TYPES } from "../dag-core/signal-types.js";

/**
 * switchTool 入参
 * @typedef {Object} SwitchToolOptions
 * @property {import("../../../engine/utils/shared-state-store.js").SharedStateStore|null|undefined} sharedState - 共享状态 store（必传键；值为 null/undefined 时跳过写 store）
 * @property {string} stateKey - 写入共享状态 store 的键
 * @property {string} toolName - 目标工具名
 * @property {string[]} [allowedTools] - 允许的工具名列表；非空数组时 toolName 必须在其中，空数组或缺省视为不校验
 */

/**
 * switchTool 返回结果
 * @typedef {Object} SwitchToolResult
 * @property {boolean} switched - 是否通过校验并完成状态发布（无 store 时仅表示校验通过）
 * @property {{ type: string, context: { activeTool: string } }|null} signal - 待路由的 tool-switch 信号；校验失败时为 null
 */

/**
 * 发布一次工具切换
 * @description
 * 纯函数、无状态：负责工具切换的「状态发布」一半——校验 + 写共享状态 store，
 * 并返回待路由的 tool-switch 信号（`context.activeTool` 携带目标工具名）。
 * 信号如何路由（设备 routeToChild、事件总线 emit 等）由调用方决定。
 *
 * 校验规则：`allowedTools` 为非空数组时 `toolName` 必须在其中，否则视为有效；
 * 无效时不写 store，返回 `{ switched: false, signal: null }`。
 *
 * 无 store 降级：`sharedState` 为 null/undefined 时不写 store，
 * 但仍返回 `switched: true` 与信号，由调用方自行维护降级状态。
 *
 * @param {SwitchToolOptions} options - 切换入参
 * @returns {SwitchToolResult} 切换结果
 */
function switchTool({ sharedState, stateKey, toolName, allowedTools } = {}) {
  const isValid =
    !Array.isArray(allowedTools) ||
    allowedTools.length === 0 ||
    allowedTools.includes(toolName);

  if (!isValid) {
    return { switched: false, signal: null };
  }

  if (sharedState) {
    sharedState.set(stateKey, toolName);
  }

  return {
    switched: true,
    signal: {
      type: SIGNAL_TYPES.TOOL_SWITCH,
      context: { activeTool: toolName },
    },
  };
}

export { switchTool };
