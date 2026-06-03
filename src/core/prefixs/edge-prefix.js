/**
 * @file 边级 prefix 工厂
 * @description
 * 创建可插入设备图边上的单节点 prefix 子图定义。
 * 传入 handler（可以是裸函数或 { handler: fn } 对象），
 * 返回一个仅含一个节点的 SubDAGDefinition，挂载后可作为源=汇的修饰节点。
 * @module core/prefixs/edge-prefix
 * @author Zhou Chenyu
 */

import { createSubDAG } from "../devices-dag/index.js";

/**
 * 创建一个单节点 prefix 子图定义（源=汇）
 * @description
 * 单源单汇子图的特例：仅含一个节点，即源即汇。
 * 用于 mount 事件的 edge.prefix 字段——插在设备节点与 workflow 之间，
 * 对途经信号做转换、过滤或路由。
 * @param {Function|{ handler: Function }} handlerOrConfig - 处理器函数，或 { handler } 对象
 * @param {{ semantics?: Object }} [options={}] - 附加配置
 * @returns {import("../devices-dag/index.js").SubDAGDefinition}
 */
export function createEdgePrefix(handlerOrConfig, options = {}) {
  const handlerFn =
    typeof handlerOrConfig === "function"
      ? handlerOrConfig
      : (handlerOrConfig?.handler ?? null);

  if (typeof handlerFn !== "function") {
    throw new TypeError(
      "createEdgePrefix requires a handler function or { handler } config.",
    );
  }

  const builder = createSubDAG("/");
  builder
    .node()
    .handler(handlerFn)
    .defaultRoute("default")
    .semantics({
      prefix: true,
      ...(options.semantics ?? {}),
    });
  return builder.build();
}
