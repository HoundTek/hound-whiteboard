/**
 * @file 基础修饰节点处理器
 * @description
 * 提供 createPrefixNodeHandler，是所有修饰节点的根基。
 * 它在 DAG 标准 handler context 之上叠加 initialState 语义，
 * 使 handle() 中看到的 ctx.state 自动合并初始默认值。
 *
 * 状态写入（setState / patchState）和路由操作（routeToChild / stop）
 * 均直接委托 DAG 提供的标准 helper，不在本模块重复实现。
 * @module core/ui/devices-dag/prefixes/handler
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../signal.js";
import { isPlainObject } from "./utils.js";

/**
 * 创建修饰节点处理器
 * @description
 * 工厂函数，生成可挂载到 DevicesDAG 节点上的 handler。
 *
 * 与直接使用 DAG 标准 handler 相比，本函数额外提供 initialState 语义：
 * - ctx.state 会优先展示 initialState 中的默认值
 * - ctx.getState() 同样合并 initialState
 * - 写入操作（setState / patchState）仅写入实际值，不持久化初始默认值
 *
 * 路由操作（routeToChild / stop）直接使用 DAG 标准 context 中的 helper。
 *
 * @param {{
 *   initialState?: Object,
 *   handle: import("../devices-dag/dag.js").DevicesDAGHandler | Array<{ path: string, signals: Array<Object> }>
 * }} options - 修饰节点处理器选项
 * @param {Object} [options.initialState] - 节点初始状态，挂载后第一次读取时与节点现有 state 合并
 * @param {import("../devices-dag/dag.js").DevicesDAGHandler} options.handle - 核心路由函数
 * @returns {import("../devices-dag/dag.js").DevicesDAGHandler} 可挂载到 DevicesDAG 节点上的处理器函数
 */
function createPrefixNodeHandler(options = {}) {
  const initialState = isPlainObject(options.initialState)
    ? { ...options.initialState }
    : {};
  const handle = typeof options.handle === "function" ? options.handle : null;

  if (!handle) {
    throw new TypeError("Prefix node handler requires handle().");
  }

  return (signalPacket, context = {}) => {
    const packet = SignalPacket.from(signalPacket, {
      defaultTo: context.path ?? "/",
    });

    return handle(packet, {
      ...context,
      state: { ...initialState, ...(context.state ?? {}) },
      getState() {
        return { ...initialState, ...(context.getState?.() ?? {}) };
      },
    });
  };
}

export { createPrefixNodeHandler };
