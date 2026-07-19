/**
 * @file 边级 prefix 工厂
 * @description
 * 创建可插入设备图边上的单节点 prefix 子图定义。
 * 传入 handler（可以是裸函数或 { handler: fn } 对象），
 * 返回一个仅含一个节点的 SubDAGDefinition，挂载后可作为源=汇的修饰节点。
 * @module core/ui-thread/devices-dag/prefixes/edge-prefix
 * @author Zhou Chenyu
 */

import { createSubDAG } from "../index.js";

/**
 * 创建一个单节点 prefix 子图定义（源=汇）
 * @description
 * 单源单汇子图的特例：仅含一个节点，即源即汇。
 * 用于 mount 事件的 edge.prefix 字段——插在设备节点与 workflow 之间，
 * 对途经信号做转换、过滤或路由。
 * @param {import("../devices-dag/dag-type.js").DevicesDAGHandler|{ handler: import("../devices-dag/dag-type.js").DevicesDAGHandler }} handlerOrConfig - 处理器函数，或 { handler } 对象
 * @param {{ semantics?: Object }} [options={}] - 附加配置
 * @returns {import("../devices-dag/dag-type.js").SubDAGDefinition}
 * @example
 * // 在 keyboardDevice 定义中使用边级 prefix 转换信号
 * const keyboardDevice = createKeyboardDevice();
 * const prefix = createEdgePrefix({
 *   handler(packet) {
 *     const triggerSignals = packet.signals.filter(
 *       (signal) => signal.type === KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
 *     );
 *     if (triggerSignals.length > 0) {
 *       return {
 *         signals: triggerSignals.map((signal) => ({
 *           type: "position",
 *           context: { value: mapKeyToPosition(signal.value) },
 *         })),
 *       };
 *     }
 *     return null;
 *   },
 * });
 *
 * // 挂载时作为 edge.prefix 传入 inputScope.addEdge 的 prefix 参数
 *
 * // 在 workflow 定义中使用边级 prefix 转换信号
 * const prefix = createEdgePrefix({
 *   handler(packet) {
 *     const positionSig = packet.signals.find((s) => s?.type === "position");
 *     if (positionSig) {
 *       const { value } = positionSig.context ?? {};
 *       return {
 *         signals: [
 *           {
 *             type: "displacement",
 *             context: { value: mapPositionToDisplacement(value) },
 *           },
 *         ],
 *       };
 *     }
 *     return null;
 *   },
 * });
 *
 * // 挂载时作为 edge.prefix 传入 inputScope.addEdge 的 prefix 参数
 */
function createEdgePrefix(handlerOrConfig, options = {}) {
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

export { createEdgePrefix };
