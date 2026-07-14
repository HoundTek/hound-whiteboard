/**
 * @file 调试 workflow 挂载
 * @description 将 C/O/M/B/T 各键通过边级 prefix 接入调试工具。
 * @module demo/config/workflows/debug
 * @author Zhou Chenyu
 */

import { createEdgePrefix } from "../../../core/ui-thread/devices-dag/prefixes/index.js";
import { buildKeyboardDebugNodeConfig } from "../prefix-builders.js";
import { DEBUG_KEYS, DEMO_WORKFLOW_NAMES } from "../constants.js";

/**
 * 挂载调试 workflow
 * @description 每个调试键独立一条边级 prefix，将 trigger 信号转为对应 debug:* 信号。
 * @param {import("../../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../debugger-tool.js").DebuggerTool} debugTool - 调试工具实例
 * @returns {void}
 */
function mountDebugControl(viewport, debugTool) {
  const scope = viewport.inputScope;
  const wfName = DEMO_WORKFLOW_NAMES.DEBUG;

  scope.mountWorkflow(wfName, debugTool);

  for (const { code, type, context } of DEBUG_KEYS) {
    scope.addEdge({
      from: `keyboard/code/${code}`,
      to: `workflows/${wfName}`,
      prefix: createEdgePrefix(buildKeyboardDebugNodeConfig(type, context)),
    });
  }
}

export { mountDebugControl };
