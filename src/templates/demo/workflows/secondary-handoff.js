/**
 * @file 右键选择→修改 handoff workflow 挂载
 * @description 将鼠标右键、Enter/Escape、WASD 汇聚到 handoff 子图。
 * @module templates/demo/workflows/secondary-handoff
 * @author Zhou Chenyu
 */

import { createEdgePrefix, createHandoffSubDAG } from "../../../core/ui-thread/devices-dag/prefixes/index.js";
import { CommonObjectModifierTool } from "../../../core/ui-thread/devices-dag/tools/modifier/common-object-modifier.js";
import { KEYBOARD_DEVICE_SIGNAL_TYPES } from "../../../core/ui-thread/devices-dag/devices/keyboard-device.js";
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
 * @returns {{ handler: import("../../../core/devices-dag/dag.js").DevicesDAGHandler }}
 */
function buildSignalForwardNodeConfig(targetType) {
  return {
    handler(packet, ctx = {}) {
      const triggerSignals = packet.signals.filter(
        (s) => s.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
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
 * @param {import("../../../core/ui/devices-dag/tools/chooser/rectangle-object-chooser.js").RectangleObjectChooserTool} secondarySelectionTool - 右键框选工具
 * @returns {void}
 */
function mountSecondaryHandoff(viewport, secondarySelectionTool) {
  const secondaryHandoffSubDAG = createHandoffSubDAG({
    rootPath: `/workflows/${DEMO_WORKFLOW_NAMES.SECONDARY_CHOOSER}`,
    first: secondarySelectionTool,
    second: new CommonObjectModifierTool(),
    autoBridgeObjects: true,
  });

  const wasdEdges = WASD_KEYS.map(({ code, vector }) => ({
    from: `keyboard/code/${code}`,
    edge: "default",
    prefix: createEdgePrefix(buildWasdNodeConfig(code, vector)),
  }));

  viewport.mountWorkflow(DEMO_WORKFLOW_NAMES.SECONDARY_CHOOSER, secondaryHandoffSubDAG, [
    { from: "mouse/secondary", edge: "default" },
    {
      from: `keyboard/code/${SUBMIT_KEY}`,
      edge: "default",
      prefix: createEdgePrefix(buildSignalForwardNodeConfig("success")),
    },
    {
      from: `keyboard/code/${CANCEL_KEY}`,
      edge: "default",
      prefix: createEdgePrefix(buildSignalForwardNodeConfig("cancel")),
    },
    ...wasdEdges,
  ]);
}

export { mountSecondaryHandoff };
