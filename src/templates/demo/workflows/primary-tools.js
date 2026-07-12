/**
 * @file 左键工具 workflow 挂载
 * @description 提供两种左键路由：直接挂笔画工具（测试用）与挂载 tool-switcher 多工具切换子图（浏览器用）。
 * @module templates/demo/workflows/primary-tools
 * @author Zhou Chenyu
 */

import { createButtonGroupDevice } from "../../../core/ui/devices-dag/devices/button-group-device.js";
import {
  createHandoffSubDAG,
  createToolSwitcherSubDAG,
} from "../../../core/ui/devices-dag/prefixes/index.js";
import { CircleCreatorTool } from "../../../core/ui/devices-dag/tools/creator/circle-creator.js";
import { RectangleObjectChooserTool } from "../../../core/ui/devices-dag/tools/chooser/rectangle-object-chooser.js";
import { CommonObjectModifierTool } from "../../../core/ui/devices-dag/tools/modifier/common-object-modifier.js";
import {
  DEMO_CIRCLE_STROKE_COLOR,
  DEMO_STROKE_WIDTH,
  DEMO_TOOL_NAMES,
  DEMO_WORKFLOW_NAMES,
} from "../constants.js";

/**
 * 将笔画工具直接挂载到鼠标左键
 * @description 不经过 tool-switcher，mouse/primary → primary-stroke 直连，用于测试等无需工具切换的场景。
 * @param {import("../../../core/ui/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../../../core/ui/devices-dag/tools/creator/stroke-creator.js").StrokeCreatorTool} primaryStrokeTool - 笔画工具实例
 * @returns {void}
 */
function mountPrimaryStrokeTool(viewport, primaryStrokeTool) {
  viewport.mountWorkflow(DEMO_WORKFLOW_NAMES.PRIMARY_STROKE, primaryStrokeTool, [
    { from: "mouse/primary", edge: "default" },
  ]);
}

/**
 * 挂载 tool-switcher 多工具切换子图
 * @description
 * 在 mouse/primary 下游挂载 tool-switcher，按当前激活工具名路由到笔画/圆/选择+修改三个子分支；
 * 同时挂载按钮组设备并建立 toolbar/button-group → tool-switcher 的双输入汇聚。
 * 本函数只做 DAG 装配，不读取 DOM；工具列表与激活回调由调用方传入。
 * @param {import("../../../core/ui/components/orchestration/board.js").Board} board - 白板实例
 * @param {import("../../../core/ui/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {Object} options - 配置项
 * @param {Array<{ name: string }>} options.tools - 工具列表
 * @param {string} options.defaultTool - 默认激活工具名
 * @param {import("../../../core/ui/devices-dag/tools/creator/stroke-creator.js").StrokeCreatorTool} options.primaryStrokeTool - 笔画工具实例
 * @param {(activeTool: string) => void} [options.onToolChange] - 工具切换回调
 * @returns {void}
 */
function mountToolSwitcher(board, viewport, options) {
  const vpId = viewport.viewportId;
  const { tools, defaultTool, primaryStrokeTool, onToolChange } = options;

  // 1. 按钮组设备：接收 button-press 信号，维护当前激活工具名
  const buttonGroupDef = createButtonGroupDevice({
    tools,
    defaultTool,
    onUpdate({ activeTool }) {
      onToolChange?.(activeTool);
    },
  });
  viewport.mountSubDAG("toolbar/button-group", buttonGroupDef);

  // 2. tool-switcher prefix：按激活工具名路由 mouse/primary 信号
  const switcherSubDAG = createToolSwitcherSubDAG({ tools, defaultTool });
  viewport.mountWorkflow(DEMO_WORKFLOW_NAMES.TOOL_SWITCHER, switcherSubDAG, [
    { from: "mouse/primary", edge: "default" },
  ]);

  const switcherPath = `/${vpId}/workflows/${DEMO_WORKFLOW_NAMES.TOOL_SWITCHER}`;

  // 3. 笔画分支 — 仅从 tool-switcher/stroke → default 可达
  const strokeEdge = board.devicesDAG.addEdge(
    `${switcherPath}/${DEMO_TOOL_NAMES.STROKE}`,
    "default",
  );
  const strokeNode = strokeEdge.target;
  const strokeProcessor = primaryStrokeTool.createProcessor();
  strokeNode.handler = strokeProcessor;
  strokeNode.semantics = { ...strokeNode.semantics, tool: true };

  // 4. 圆分支 — 仅从 tool-switcher/circle → default 可达
  const circleCreatorTool = new CircleCreatorTool({
    property: {
      strokeColor: DEMO_CIRCLE_STROKE_COLOR,
      strokeWidth: DEMO_STROKE_WIDTH,
    },
  });
  const circleEdge = board.devicesDAG.addEdge(
    `${switcherPath}/${DEMO_TOOL_NAMES.CIRCLE}`,
    "default",
  );
  const circleNode = circleEdge.target;
  const circleProcessor = circleCreatorTool.createProcessor();
  circleNode.handler = circleProcessor;
  circleNode.semantics = { ...circleNode.semantics, tool: true };

  // 5. 选择+修改分支（handoff）— 仅从 tool-switcher/select → default 可达
  const selectHandoffSubDAG = createHandoffSubDAG({
    rootPath: `/`,
    first: new RectangleObjectChooserTool(),
    second: new CommonObjectModifierTool(),
    autoBridgeObjects: true,
  });
  const selectEdge = board.devicesDAG.addEdge(
    `${switcherPath}/${DEMO_TOOL_NAMES.SELECT}`,
    "default",
  );
  board.devicesDAG.mountSubDAG("", {
    ...selectHandoffSubDAG,
    rootPath: selectEdge.target.path,
  });

  // 6. 双输入汇聚：toolbar/button-group → tool-switcher
  board.devicesDAG.addEdge(
    `/${vpId}/toolbar/button-group`,
    "default",
    switcherPath,
  );
}

export { mountPrimaryStrokeTool, mountToolSwitcher };
