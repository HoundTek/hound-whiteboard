/**
 * @file 工具切换路由 prefix
 * @description
 * 提供 createToolSwitcherSubDAG 工厂函数，创建纯路由子图。
 * 不持有按钮组逻辑——按钮组由 button-group-device 独立管理。
 * 和 handoff-handler 同构，都是状态机路由节点。
 * @module core/ui/devices-dag/prefixes/tool-switcher
 * @author Zhou Chenyu
 */

import { createSubDAG } from "../index.js";
import { SignalPacket } from "../signal.js";
import { DEVICE_DEFAULT_ROUTE } from "../devices/constant.js";
import { BUTTON_GROUP_DEVICE_SIGNAL_TYPES } from "../devices/button-group-device.js";

/**
 * @typedef {Object} ToolSwitcherOptions
 * @property {Array<{name: string}>} tools - 工具配置列表
 * @property {string} [defaultTool] - 默认路由目标，省略时使用 tools[0].name
 */

/**
 * @typedef {Object} ToolSwitcherSubDAGDefinition
 * @property {() => string} getRouteTarget - 获取当前路由目标
 * @property {(toolName: string) => void} setRouteTarget - 设置路由目标
 * @property {() => void} resetState - 重置为默认路由目标
 */

/**
 * 创建工具切换子图
 * @description
 * 生成一棵子树，结构：
 * ```
 * tool-switcher(root, 路由处理器)
 *   ├── "stroke"  → stroke 子节点（透传节点，defaultRoute="default"）
 *   ├── "circle"  → circle 子节点
 *   └── "select"  → select 子节点
 * ```
 *
 * 根节点接受双输入汇聚：
 * ```
 * / → viewport/
 *       ├── mouse/primary  ──"default"──────→  workflows/tool-switcher
 *       └── toolbar/button-group  ──"default"──→  workflows/tool-switcher
 *                                                  ├── "stroke" ──"default"──→  StrokeCreatorTool
 *                                                  ├── "circle" ──"default"──→  CircleCreatorTool
 *                                                  └── "select" ──"default"──→  handoff-subDAG
 * ```
 *
 * 路由规则：
 * - 收到 `tool-switch` 信号（携带 activeTool）→ 更新 routeTarget，stop
 * - 收到其他信号（鼠标 position/end）→ 转发到 routeTarget 对应的子节点
 *
 * @param {ToolSwitcherOptions} [options={}] - 工具切换配置
 * @returns {import("../dag.js").SubDAGDefinition & ToolSwitcherSubDAGDefinition}
 *
 * @example
 * ```js
 * const switcher = createToolSwitcherSubDAG({
 *   tools: [{ name: "stroke" }, { name: "circle" }],
 *   defaultTool: "stroke",
 * });
 * ```
 */
function createToolSwitcherSubDAG(options = {}) {
  const {
    /** @type {Array<{name: string}>} */
    tools = [],
  } = options;

  const defaultRouteTarget =
    typeof options.defaultTool === "string" && options.defaultTool
      ? options.defaultTool
      : tools[0]?.name ?? "";

  let routeTarget = defaultRouteTarget;

  /**
   * 路由处理器
   * @description
   * 识别 `tool-switch` 专属信号更新路由目标，
   * 其余信号（鼠标 position/end）转发到当前路由目标。
   *
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../dag.js").DevicesDAGHandlerContext} ctx - 设备图处理器上下文
   * @returns {import("../dag.js").DevicesDAGHandlerResult}
   */
  const routerHandler = (signalPacket, ctx = {}) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "" });

    // 专属信号：来自按钮组设备的 tool-switch
    const switchSignal = packet.signals.find(
      (s) => s?.type === BUTTON_GROUP_DEVICE_SIGNAL_TYPES.TOOL_SWITCH,
    );
    if (switchSignal) {
      const target = switchSignal?.context?.activeTool;
      if (typeof target === "string" && target && target !== routeTarget) {
        const oldTarget = routeTarget;
        routeTarget = target;
        // 先向旧工具发送 end-action 让其优雅收尾，再切换路由目标
        ctx.patchState?.({ routeTarget });
        if (oldTarget) {
          return ctx.routeToChild(oldTarget, [
            { type: "end-action", context: {} },
          ]);
        }
      }
      return ctx.stop();
    }

    // 同步 routeTarget 到节点状态，供调试与外部观察
    ctx.patchState?.({ routeTarget });

    // 鼠标等常规信号 → 转发到当前路由目标
    if (routeTarget) {
      return ctx.routeToChild(routeTarget, packet.signals);
    }

    return ctx.stop();
  };

  const builder = createSubDAG("/");
  const root = builder
    .node()
    .handler(routerHandler)
    .defaultRoute(defaultRouteTarget)
    .semantics({ prefix: true, prefixKind: "tool-switcher" });

  // 为每个工具创建透传子节点
  for (const { name } of tools) {
    const child = builder.node().defaultRoute(DEVICE_DEFAULT_ROUTE);
    builder.edge(name, root, child);
  }

  return builder
    .expose({
      /**
       * 获取当前路由目标
       * @returns {string}
       */
      getRouteTarget() {
        return routeTarget;
      },

      /**
       * 设置路由目标
       * @param {string} toolName - 目标工具名
       * @returns {void}
       */
      setRouteTarget(toolName) {
        if (typeof toolName === "string" && toolName) {
          routeTarget = toolName;
        }
      },

      /**
       * 重置为默认路由目标
       * @returns {void}
       */
      resetState() {
        routeTarget = defaultRouteTarget;
      },
    })
    .build();
}

export { createToolSwitcherSubDAG };
