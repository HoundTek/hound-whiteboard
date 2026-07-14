/**
 * @file 调试 workflow 挂载
 * @description 将 C/O/M/B/T 各键通过边级 prefix 接入调试工具。
 * @module templates/demo/workflows/debug
 * @author Zhou Chenyu
 */

import { createEdgePrefix } from "../../../core/ui-thread/devices-dag/prefixes/index.js";
import { buildKeyboardDebugNodeConfig } from "../prefix-builders.js";
import { DEBUG_KEYS, DEMO_WORKFLOW_NAMES } from "../constants.js";

/**
 * 挂载调试 workflow
 * @description 每个调试键独立一条边级 prefix，将 trigger 信号转为对应 debug:* 信号。
 * @param {import("../../../core/ui/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../debugger-tool.js").DebuggerTool} debugTool - 调试工具实例
 * @returns {void}
 */
function mountDebugControl(viewport, debugTool) {
  const debugEdges = DEBUG_KEYS.map(({ code, type, context }) => ({
    from: `keyboard/code/${code}`,
    edge: "default",
    prefix: createEdgePrefix(buildKeyboardDebugNodeConfig(type, context)),
  }));

  viewport.mountWorkflow(DEMO_WORKFLOW_NAMES.DEBUG, debugTool, debugEdges);
}

export { mountDebugControl };
