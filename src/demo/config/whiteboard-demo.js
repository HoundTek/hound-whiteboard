/**
 * @file whiteboard demo 配置入口
 * @description 编排 demo 设备子图与各 workflow 的挂载，并提供公共符号的统一导出。
 * @module demo/config/whiteboard-demo
 * @author Zhou Chenyu
 */

import { StrokeCreatorTool } from "../../core/ui-thread/devices-dag/tools/creator/stroke-creator.js";
import { RectangleObjectChooserTool } from "../../core/ui-thread/devices-dag/tools/chooser/rectangle-object-chooser.js";
import { DebuggerTool } from "./debugger-tool.js";
import { ViewportTool } from "./viewport-tool.js";
import { mountDemoDevices } from "./devices.js";
import { mountSecondaryHandoff } from "./workflows/secondary-handoff.js";
import { mountRandomCircle } from "./workflows/random-circle.js";
import { mountViewportControl } from "./workflows/viewport.js";
import { mountDebugControl } from "./workflows/debug.js";
import { mountPrimaryStrokeTool, mountToolSwitcher } from "./workflows/primary-tools.js";
import { DemoLog, formatShortcutLegend } from "./log.js";
import {
  DEMO_PRIMARY_STROKE_COLOR,
  DEMO_STROKE_WIDTH,
} from "./constants.js";

// 重新导出公共符号，供测试与外部消费者使用
export {
  mountPrimaryStrokeTool,
  mountToolSwitcher,
} from "./workflows/primary-tools.js";
export {
  buildKeyboardDebugNodeConfig,
  buildKeyboardTriggerForwardNodeConfig,
  buildViewportFlushNodeConfig,
  buildViewportPositionNodeConfig,
  buildViewportScaleNodeConfig,
  buildWasdNodeConfig,
} from "./prefix-builders.js";
export {
  CANCEL_KEY,
  DEBUG_KEYS,
  DEMO_CIRCLE_STROKE_COLOR,
  DEMO_KEYBOARD_INPUT_CODES,
  DEMO_PRIMARY_STROKE_COLOR,
  DEMO_STROKE_WIDTH,
  DEMO_TOOL_NAMES,
  DEMO_VIEWPORT_POSITION_STEP,
  DEMO_VIEWPORT_SCALE_FACTOR,
  DEMO_WORKFLOW_NAMES,
  RANDOM_CIRCLE_KEY,
  SUBMIT_KEY,
  VIEWPORT_FLUSH_KEYS,
  VIEWPORT_POSITION_KEYS,
  VIEWPORT_SCALE_KEYS,
  WASD_KEYS,
} from "./constants.js";

/**
 * 配置白板 Demo 的设备子图与共享 workflow
 * @description
 * 为指定 board 和 viewport 挂载鼠标/键盘/触摸设备子图，注册右键 handoff、随机圆、
 * 视口控制、调试等 workflow。本函数不挂载 mouse/primary 上的左键工具——由调用方通过
 * {@link mountPrimaryStrokeTool} 或 {@link mountToolSwitcher} 显式选择左键路由。
 *
 * @param {import("../../core/ui-thread/components/orchestration/board.js").Board} board - 白板实例
 * @param {import("../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {Object} [options={}] - 可选覆盖配置
 * @param {ViewportTool} [options.viewportTool] - 自定义视口工具实例
 * @param {DebuggerTool} [options.debugTool] - 自定义调试工具实例
 * @returns {{
 *   viewportTool: ViewportTool,
 *   primaryStrokeTool: import("../../core/ui-thread/devices-dag/tools/creator/stroke-creator.js").StrokeCreatorTool,
 *   secondarySelectionTool: import("../../core/ui-thread/devices-dag/tools/chooser/rectangle-object-chooser.js").RectangleObjectChooserTool,
 *   debugTool: DebuggerTool,
 * }}
 */
function configureWhiteboardDemo(board, viewport, options = {}) {
  if (!board || !viewport) {
    throw new TypeError("configureWhiteboardDemo requires board and viewport");
  }

  const primaryStrokeTool = new StrokeCreatorTool({
    property: { color: DEMO_PRIMARY_STROKE_COLOR, width: DEMO_STROKE_WIDTH },
  });
  const secondarySelectionTool = new RectangleObjectChooserTool();
  const viewportTool = options.viewportTool ?? new ViewportTool();
  const debugTool = options.debugTool ?? new DebuggerTool();

  mountDemoDevices(viewport);
  mountSecondaryHandoff(viewport, secondarySelectionTool);
  mountRandomCircle(viewport);
  mountViewportControl(viewport, viewportTool);
  mountDebugControl(viewport, debugTool);

  const demoLog = new DemoLog("DemoConfig");
  demoLog.status(formatShortcutLegend());

  return {
    viewportTool,
    primaryStrokeTool,
    secondarySelectionTool,
    debugTool,
  };
}

export { configureWhiteboardDemo };
