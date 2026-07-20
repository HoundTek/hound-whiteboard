/**
 * @file 左键工具 workflow 挂载
 * @description 提供两种左键路由：直接挂笔画工具（测试用）与挂载 tool-switcher 多工具切换 wrapper（浏览器用）。
 * @module demo/config/workflows/primary-tools
 * @author Zhou Chenyu
 */

import { createButtonGroupDevice } from "../../../core/ui-thread/devices-dag/devices/button-group-device.js";
import { HandoffWrapperTool } from "../../../core/ui-thread/devices-dag/tools/wrapper/handoff-wrapper.js";
import { ToolSwitcherWrapper } from "../../../core/ui-thread/devices-dag/tools/wrapper/switcher-wrapper.js";
import { CircleCreatorTool } from "../../../core/ui-thread/devices-dag/tools/creator/circle-creator.js";
import { RectangleObjectChooserTool } from "../../../core/ui-thread/devices-dag/tools/chooser/rectangle-object-chooser.js";
import { CommonObjectModifierTool } from "../../../core/ui-thread/devices-dag/tools/modifier/common-object-modifier.js";
import {
  DEMO_CIRCLE_STROKE_COLOR,
  DEMO_STROKE_WIDTH,
  DEMO_TOOL_NAMES,
  DEMO_WORKFLOW_NAMES,
} from "../constants.js";

/**
 * 将笔画工具直接挂载到鼠标左键
 * @description 不经过 tool-switcher，mouse/primary → primary-stroke 直连，用于测试等无需工具切换的场景。
 * @param {import("../../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../../../core/ui/devices-dag/tools/creator/stroke-creator.js").StrokeCreatorTool} primaryStrokeTool - 笔画工具实例
 * @returns {void}
 */
function mountPrimaryStrokeTool(viewport, primaryStrokeTool) {
  const scope = viewport.inputScope;
  scope.mountWorkflow(DEMO_WORKFLOW_NAMES.PRIMARY_STROKE, primaryStrokeTool);
  scope.addEdge({
    from: "mouse/primary",
    to: `workflows/${DEMO_WORKFLOW_NAMES.PRIMARY_STROKE}`,
  });
}

/**
 * 挂载 tool-switcher 多工具切换 wrapper
 * @description
 * 在 mouse/primary 下游挂载单个 ToolSwitcherWrapper，按当前激活工具名
 * 在笔画/圆/选择+修改三个内部槽位间路由；选择+修改分支为 HandoffWrapperTool。
 * 同时挂载按钮组设备并建立 toolbar/button-group → tool-switcher 的双输入汇聚。
 * 本函数只做 DAG 装配，不读取 DOM；工具列表与激活回调由调用方传入。
 * @param {import("../../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {Object} options - 配置项
 * @param {Array<{ name: string }>} options.tools - 工具列表
 * @param {string} options.defaultTool - 默认激活工具名
 * @param {import("../../../core/ui/devices-dag/tools/creator/stroke-creator.js").StrokeCreatorTool} options.primaryStrokeTool - 笔画工具实例
 * @param {(activeTool: string) => void} [options.onToolChange] - 工具切换回调
 * @returns {void}
 */
function mountToolSwitcher(viewport, options) {
  const { tools, defaultTool, primaryStrokeTool, onToolChange } = options;

  const scope = viewport.inputScope;

  // 1. 按钮组设备：接收 button-press 信号，维护当前激活工具名
  const buttonGroupDef = createButtonGroupDevice({
    tools,
    defaultTool,
    onUpdate({ activeTool }) {
      onToolChange?.(activeTool);
    },
  });
  scope.mountDevice("toolbar/button-group", buttonGroupDef);

  // 2. tool-switcher wrapper：按激活工具名路由 mouse/primary 信号
  const circleCreatorTool = new CircleCreatorTool({
    property: {
      strokeColor: DEMO_CIRCLE_STROKE_COLOR,
      strokeWidth: DEMO_STROKE_WIDTH,
    },
  });
  const selectHandoffTool = new HandoffWrapperTool({
    first: new RectangleObjectChooserTool(),
    second: new CommonObjectModifierTool(),
  });
  const switcherWrapper = new ToolSwitcherWrapper({
    tools: [
      { name: DEMO_TOOL_NAMES.STROKE, tool: primaryStrokeTool },
      { name: DEMO_TOOL_NAMES.CIRCLE, tool: circleCreatorTool },
      { name: DEMO_TOOL_NAMES.SELECT, tool: selectHandoffTool },
    ],
    defaultTool,
  });
  scope.mountWorkflow(DEMO_WORKFLOW_NAMES.TOOL_SWITCHER, switcherWrapper);

  // 3. 双输入汇聚：mouse/primary 与 toolbar/button-group → tool-switcher
  scope.addEdge({
    from: "mouse/primary",
    to: `workflows/${DEMO_WORKFLOW_NAMES.TOOL_SWITCHER}`,
  });
  scope.addEdge({
    from: "toolbar/button-group",
    to: `workflows/${DEMO_WORKFLOW_NAMES.TOOL_SWITCHER}`,
  });
}

export { mountPrimaryStrokeTool, mountToolSwitcher };
