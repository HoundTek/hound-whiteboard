/**
 * @file 右键选择→修改 handoff workflow 挂载
 * @description 将鼠标右键、Enter/Escape、WASD 汇聚到 handoff wrapper。
 * @module demo/config/workflows/secondary-handoff
 * @author Zhou Chenyu
 */

import { createEdgePrefix } from "../../../core/ui-thread/devices-dag/prefixes/index.js";
import { HandoffWrapperTool } from "../../../core/ui-thread/devices-dag/tools/wrapper/handoff-wrapper.js";
import { CommonObjectModifierTool } from "../../../core/ui-thread/devices-dag/tools/modifier/common-object-modifier.js";
import { DragGestureProcessor } from "../../../core/ui-thread/devices-dag/tools/modifier/gesture/drag-processor.js";
import { SIGNAL_TYPES } from "../../../core/ui-thread/devices-dag/dag-core/signal-types.js";
import { buildWasdNodeConfig } from "../prefix-builders.js";
import {
  CANCEL_KEY,
  DEMO_WORKFLOW_NAMES,
  SUBMIT_KEY,
  WASD_KEYS,
} from "../constants.js";

/**
 * 构建键盘 trigger → 指定类型信号的转发 prefix handler
 * @description Enter 转 success、Escape 转 cancel，路由到 handoff modifier 阶段。
 * @param {string} targetType - 目标信号类型
 * @returns {{ handler: import("../../../core/ui-thread/devices-dag/dag-type.js").DevicesDAGHandler }}
 */
function buildSignalForwardNodeConfig(targetType) {
  return {
    handler(packet, ctx = {}) {
      const triggerSignals = packet.signals.filter(
        (s) => s.type === SIGNAL_TYPES.TRIGGER,
      );
      if (triggerSignals.length === 0) return ctx.stop();
      return ctx.routeToChild(ctx.defaultRoute || "", [
        ctx.signal(targetType, undefined, {}),
      ]);
    },
  };
}

/**
 * 挂载右键选择→修改 handoff workflow
 * @description 鼠标右键驱动 chooser 框选；Enter 提交、Escape 取消；WASD 在 modifier 阶段产生 displacement。
 * @param {import("../../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../../../core/ui-thread/devices-dag/tools/chooser/rectangle-object-chooser.js").RectangleObjectChooserTool} secondarySelectionTool - 右键框选工具
 * @returns {void}
 */
function mountSecondaryHandoff(viewport, secondarySelectionTool) {
  const scope = viewport.inputScope;
  const wfName = DEMO_WORKFLOW_NAMES.SECONDARY_CHOOSER;

  const secondaryHandoffTool = new HandoffWrapperTool({
    first: secondarySelectionTool,
    second: new CommonObjectModifierTool({ processor: new DragGestureProcessor() }),
  });

  scope.mountWorkflow(wfName, secondaryHandoffTool);

  scope.addEdge({ from: "mouse/secondary", to: `workflows/${wfName}` });
  scope.addEdge({
    from: `keyboard/code/${SUBMIT_KEY}`,
    to: `workflows/${wfName}`,
    prefix: createEdgePrefix(buildSignalForwardNodeConfig("success")),
  });
  scope.addEdge({
    from: `keyboard/code/${CANCEL_KEY}`,
    to: `workflows/${wfName}`,
    prefix: createEdgePrefix(buildSignalForwardNodeConfig("cancel")),
  });
  for (const { code, vector } of WASD_KEYS) {
    scope.addEdge({
      from: `keyboard/code/${code}`,
      to: `workflows/${wfName}`,
      prefix: createEdgePrefix(buildWasdNodeConfig(code, vector)),
    });
  }
}

export { mountSecondaryHandoff };
