/**
 * @file 按钮组设备
 * @description 提供工具栏按钮组输入信号的设备图节点创建与处理接口。
 * @module core/ui-thread/devices-dag/devices/button-group-device
 * @author Zhou Chenyu
 */

import { createSubDAG } from "../index.js";
import { SignalPacket } from "../dag-core/signal.js";
import { DEVICE_DEFAULT_ROUTE } from "./constant.js";

/**
 * 按钮组设备输出信号类型
 * @type {{TOOL_SWITCH: string}}
 */
const BUTTON_GROUP_DEVICE_SIGNAL_TYPES = Object.freeze({
  TOOL_SWITCH: "tool-switch",
});

/**
 * 按钮组设备配置
 * @typedef {Object} ButtonGroupDeviceOptions
 * @property {Array<{name: string}>} [tools] - 允许的工具名列表（空数组时不校验）
 * @property {string} defaultTool - 默认激活工具（必传，无默认值——初始激活工具是接线决策）
 * @property {string} stateKey - 写入共享状态 store 的键（必传，无默认值——键是接线的一部分，由接线层注册）；
 * 多个按钮组各自操控不同的 tool-switcher 时，必须为每个设备实例传入互不相同的键
 */

/**
 * 按钮组设备子图定义
 * @typedef {import("../dag-type.js").SubDAGDefinition & {
 *   getState: () => { activeTool: string },
 *   resetState: () => void,
 * }} ButtonGroupSubDAGDefinition
 */

/**
 * 创建一张按钮组设备子图
 * @description
 * 接受 DOM 工具栏按钮发出的 button-press 信号（携带 toolName），
 * 管理互斥激活状态，通过共享状态 store（`ctx.services.sharedState`）
 * 向图外消费者（如 DOM 工具栏高亮）发布当前激活工具，
 * 并向下游 emit tool-switch 信号供 ToolSwitcherWrapper 消费。
 *
 * 输出信道的标准接口是共享状态 store：设备只负责 `set`，
 * 不关心消费者是谁。无 sharedState 时降级为本地跟踪值，仍发信号。
 *
 * 根节点通过 "default" 边连接到下游 tool-switcher。
 *
 * @param {ButtonGroupDeviceOptions} options - 按钮组配置（`stateKey` 必传）
 * @returns {ButtonGroupSubDAGDefinition}
 */
function createButtonGroupDevice(options = {}) {
  if (typeof options.stateKey !== "string" || !options.stateKey) {
    throw new TypeError(
      "createButtonGroupDevice requires a non-empty stateKey option.",
    );
  }

  if (typeof options.defaultTool !== "string" || !options.defaultTool) {
    throw new TypeError(
      "createButtonGroupDevice requires a non-empty defaultTool option.",
    );
  }

  const { tools = [] } = options;
  const defaultTool = options.defaultTool;
  const stateKey = options.stateKey;

  // 无 sharedState 时的本地跟踪值
  let localActiveTool = defaultTool;

  // 最近一次 dispatch 捕获的 sharedState 引用，供 getState / resetState 使用
  let storeRef = null;

  /**
   * 从上下文解析 sharedState 并缓存引用
   * @param {import("../dag-type.js").DevicesDAGHandlerContext} ctx - 设备图处理器上下文
   * @returns {import("../../../engine/utils/shared-state-store.js").SharedStateStore|null}
   */
  const resolveSharedState = (ctx) => {
    const sharedState = ctx?.services?.sharedState;
    if (sharedState) {
      storeRef = sharedState;
    }
    return sharedState ?? null;
  };

  /**
   * 根节点处理器
   * @description
   * 1. store 中激活工具键无值时写入 defaultTool 作为初始值
   * 2. 从信号中解析 button-press（含 toolName），校验通过后写入 store
   * 3. 以当前生效值为准发出 tool-switch 信号到下游（ToolSwitcherWrapper）
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../dag-type.js").DevicesDAGHandlerContext} ctx - 设备图处理器上下文
   * @returns {import("../dag-type.js").DevicesDAGHandlerResult}
   */
  const rootHandler = (signalPacket, ctx = {}) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "" });
    const sharedState = resolveSharedState(ctx);

    // 首次 dispatch 时写入默认值作为初始值
    if (sharedState && sharedState.get(stateKey) === undefined) {
      sharedState.set(stateKey, defaultTool);
    }

    const press = packet.signals.find(
      (s) => s?.type === "button-press" && s?.context?.toolName,
    );
    if (press) {
      const toolName = press.context.toolName;
      const isValid =
        tools.length === 0 || tools.some((t) => t.name === toolName);
      if (isValid) {
        if (sharedState) {
          sharedState.set(stateKey, toolName);
        } else {
          localActiveTool = toolName;
        }
      }
    }

    const activeTool = sharedState?.get(stateKey) ?? localActiveTool;

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
       * @description 优先从 sharedState 读取，无 store 时返回本地跟踪值。
       * @returns {{activeTool: string}}
       */
      getState() {
        return { activeTool: storeRef?.get(stateKey) ?? localActiveTool };
      },

      /**
       * 重置为默认工具
       * @description store 可用时写入 store（同步通知订阅者），否则重置本地跟踪值。
       * @returns {void}
       */
      resetState() {
        if (storeRef) {
          storeRef.set(stateKey, defaultTool);
        } else {
          localActiveTool = defaultTool;
        }
      },
    })
    .build();
}

export { createButtonGroupDevice, BUTTON_GROUP_DEVICE_SIGNAL_TYPES };
