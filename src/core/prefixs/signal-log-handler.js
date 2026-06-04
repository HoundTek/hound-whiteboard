/**
 * @file 信号日志修饰节点处理器
 * @description
 * 透传所有经过该节点的信号，同时将其打印到 console。
 * 用于调试时观察信号流转，不影响下游链路。
 * @module core/prefixs/signal-log-handler
 * @author Zhou Chenyu
 */

import { createPrefixNodeHandler } from "./handler.js";

/**
 * 创建信号日志修饰节点处理器
 *
 * @description
 * 工厂函数，生成一个透传处理器：所有到达该节点的信号包都会被
 * `console.log` 打印，然后原样路由到默认子节点。
 *
 * @param {{
 *   label?: string,
 * }} [options={}] - 配置选项
 * @param {string} [options.label="[SignalLog]"] - 日志前缀标签，便于区分多个 log handler
 * @returns {import("../devices-dag/dag.js").DevicesDAGHandler}
 *
 * @example
 * builder
 *   .prefix(createSignalLogPrefixHandler({ label: "[Debug]" }))
 *   .defaultRoute("tool")
 *   .node("tool")
 *   .tool(new SomeTool())
 *   .end();
 */
function createSignalLogPrefixHandler(options = {}) {
  const label =
    typeof options.label === "string" ? options.label : "[SignalLog]";

  return createPrefixNodeHandler({
    handle(packet, ctx) {
      const signals = packet.signals ?? [];
      const to = packet.to ?? "";

      console.log(
        `${label} to="${to}" signals=%o`,
        signals.length === 1 ? signals[0] : signals,
      );

      return ctx.routeToChild(ctx.defaultRoute || "", signals);
    },
  });
}

export { createSignalLogPrefixHandler };
