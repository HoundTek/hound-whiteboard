/**
 * @file demo 设备子图挂载
 * @description 挂载鼠标、键盘、触摸三个设备子图以及触摸多指笔画 workflow。
 * @module demo/config/devices
 * @author Zhou Chenyu
 */

import { createMouseDevice } from "../../core/ui-thread/devices-dag/devices/mouse-device.js";
import { createTouchscreenDevice } from "../../core/ui-thread/devices-dag/devices/touchscreen-device.js";
import { createKeyboardDevice } from "../../core/ui-thread/devices-dag/devices/keyboard-device.js";
import { StrokeCreatorTool } from "../../core/ui-thread/devices-dag/tools/creator/stroke-creator.js";
import { DevicesDAGNode } from "../../core/ui-thread/devices-dag/dag-node-edge.js";
import { createSubDAG } from "../../core/ui-thread/devices-dag/index.js";
import { MultiToolWrapper } from "../../core/ui-thread/devices-dag/tools/wrapper/multi-tool-wrapper.js";
import { DEMO_STROKE_WIDTH, DEMO_WORKFLOW_NAMES } from "./constants.js";

/**
 * 挂载 demo 设备子图与触摸笔画 workflow
 * @description
 * 为视口挂载 mouse/keyboard/touchscreen 三个设备子图，并为 touchscreen/contacts 挂载
 * 多指并发笔画包装器，使每指独立创建一条笔画。
 * @param {import("../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @returns {void}
 */
function mountDemoDevices(viewport) {
  const scope = viewport.inputScope;
  scope.mountDevice("mouse", createMouseDevice());
  scope.mountDevice("keyboard", createKeyboardDevice());
  scope.mountDevice("touchscreen", createTouchscreenDevice());

  const touchStrokeTool = new MultiToolWrapper((touchId) => {
    const builder = createSubDAG("/touch");
    builder.node().tool(
      new StrokeCreatorTool({
        property: {
          color: TOUCH_COLORS[parseInt(touchId, 10) % TOUCH_COLORS.length],
          width: DEMO_STROKE_WIDTH,
        },
      }),
    );
    return DevicesDAGNode.createGraph(builder.build());
  });
  scope.mountWorkflow(DEMO_WORKFLOW_NAMES.TOUCH_STROKE, touchStrokeTool);
  scope.addEdge({
    from: "touchscreen/contacts",
    to: `workflows/${DEMO_WORKFLOW_NAMES.TOUCH_STROKE}`,
  });
}

/**
 * 触控点位对应的颜色调色板（HSL 均匀分布，10 色循环）
 * @type {string[]}
 */
const TOUCH_COLORS = [
  "#FF6B6B", // 红
  "#4ECDC4", // 青
  "#45B7D1", // 蓝
  "#96CEB4", // 绿
  "#FFEAA7", // 黄
  "#DDA0DD", // 梅
  "#FF9FF3", // 粉
  "#54A0FF", // 天蓝
  "#5F27CD", // 紫
  "#01A3A4", // 深青
];

export { mountDemoDevices };
