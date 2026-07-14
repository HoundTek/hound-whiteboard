/**
 * @file 按钮组设备
 * @description 提供工具栏按钮组输入信号的设备图节点创建与处理接口。
 * @module core/ui-thread/devices-dag/devices/button-group-device
 * @author Zhou Chenyu
 */

import { createSubDAG } from "../index.js";
import { SignalPacket } from "../signal.js";
import { DEVICE_DEFAULT_ROUTE } from "./constant.js";

/**
 * 按钮组设备输出信号类型
 * @type {{TOOL_SWITCH: string}}
 */
const BUTTON_GROUP_DEVICE_SIGNAL_TYPES = Object.freeze({
  TOOL_SWITCH: "tool-switch",
});

/**
 * 创建一张按钮组设备子图
 * @description
 * 接受 DOM 工具栏按钮发出的 button-press 信号（携带 toolName），
 * 管理互斥激活状态，通知 DOM 更新高亮，
 * 并向下游 emit tool-switch 信号供 tool-switcher prefix 消费。
 *
 * 根节点通过 "default" 边连接到下游 tool-switcher。
 *
 * @param {Object} [options={}] - 按钮组配置
 * @param {Array<{name: string}>} [options.tools] - 允许的工具名列表（空数组时不校验）
 * @param {string} [options.defaultTool] - 默认激活工具，省略时使用 tools[0].name
 * @param {(state: {activeTool: string}) => void} [options.onUpdate] - 按钮状态变更回调（输出信道→DOM）
 * @returns {import("../dag.js").SubDAGDefinition & {
 *   getState: () => { activeTool: string },
 *   resetState: () => void,
 * }}
 */
function createButtonGroupDevice(options = {}) {
  const { tools = [], onUpdate } = options;
  const defaultTool =
    typeof options.defaultTool === "string" && options.defaultTool
      ? options.defaultTool
      : tools[0]?.name ?? "";

  let activeTool = defaultTool;

  /**
   * 根节点处理器
   * @description
   * 1. 从信号中解析 button-press（含 toolName）
   * 2. 更新内部激活工具状态
   * 3. 通知 DOM 回调
   * 4. 发出 tool-switch 信号到下游（tool-switcher prefix）
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../dag.js").DevicesDAGHandlerContext} ctx - 设备图处理器上下文
   * @returns {import("../dag.js").DevicesDAGHandlerResult}
   */
  const rootHandler = (signalPacket, ctx = {}) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "" });

    const press = packet.signals.find(
      (s) => s?.type === "button-press" && s?.context?.toolName,
    );
    if (press) {
      const toolName = press.context.toolName;
      const isValid = tools.length === 0 || tools.some((t) => t.name === toolName);
      if (isValid) {
        activeTool = toolName;
        if (typeof onUpdate === "function") {
          onUpdate({ activeTool });
        }
      }
    }

    // 向下游发出 tool-switch 信号
    return ctx.routeToChild(ctx.defaultRoute || "", [
      ctx.signal(BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH, undefined, {
        activeTool,
      }),
    ]);
  };

  const builder = createSubDAG("/");
  builder
    .node()
    .handler(rootHandler)
    .defaultRoute(DEVICE_DEFAULT_ROUTE);

  return builder
    .expose({
      /**
       * 获取当前激活工具状态
       * @returns {{activeTool: string}}
       */
      getState() {
        return { activeTool };
      },

      /**
       * 重置为默认工具
       * @returns {void}
       */
      resetState() {
        activeTool = defaultTool;
      },
    })
    .build();
}

export { createButtonGroupDevice, BUTTON_GROUP_DEVICE_SIGNAL_TYPES };
