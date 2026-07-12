/**
 * @file demo 设备子图挂载
 * @description 挂载鼠标、键盘、触摸三个设备子图以及触摸多指笔画 workflow。
 * @module templates/demo/devices
 * @author Zhou Chenyu
 */

import { createMouseDevice } from "../../core/ui/devices-dag/devices/mouse-device.js";
import { createTouchscreenDevice } from "../../core/ui/devices-dag/devices/touchscreen-device.js";
import { createKeyboardDevice } from "../../core/ui/devices-dag/devices/keyboard-device.js";
import { StrokeCreatorTool } from "../../core/ui/devices-dag/tools/creator/stroke-creator.js";
import { MultiToolWrapper } from "../../core/ui/devices-dag/tools/multi-tool-wrapper.js";
import {
  DEMO_PRIMARY_STROKE_COLOR,
  DEMO_STROKE_WIDTH,
  DEMO_WORKFLOW_NAMES,
} from "./constants.js";

/**
 * 挂载 demo 设备子图与触摸笔画 workflow
 * @description
 * 为视口挂载 mouse/keyboard/touchscreen 三个设备子图，并为 touchscreen/contacts 挂载
 * 多指并发笔画包装器，使每指独立创建一条笔画。
 * @param {import("../../core/ui/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @returns {void}
 */
function mountDemoDevices(viewport) {
  viewport.mountSubDAG("mouse", createMouseDevice());
  viewport.mountSubDAG("keyboard", createKeyboardDevice());
  viewport.mountSubDAG("touchscreen", createTouchscreenDevice());

  const touchStrokeTool = new MultiToolWrapper(StrokeCreatorTool, {
    property: { color: DEMO_PRIMARY_STROKE_COLOR, width: DEMO_STROKE_WIDTH },
  });
  viewport.mountWorkflow(DEMO_WORKFLOW_NAMES.TOUCH_STROKE, touchStrokeTool, [
    { from: "touchscreen/contacts", edge: "default" },
  ]);
}

export { mountDemoDevices };
