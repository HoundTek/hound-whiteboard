/**
 * @file 基础修饰节点处理器
 * @description
 * 提供 createPrefixNodeHandler，是所有修饰节点的根基。
 * 它在首次调用时将 initialState 写入节点实际 state，
 * 此后 handler 内外的 state 形状始终一致。
 *
 * 状态写入（setState / patchState）和路由操作（routeToChild / stop）
 * 均直接委托 DAG 提供的标准 helper，不在本模块重复实现。
 * @module core/ui-thread/devices-dag/prefixes/handler
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../dag-core/signal.js";
import { isPlainObject } from "./utils.js";

/**
 * 创建修饰节点处理器
 * @description
 * 工厂函数，生成可挂载到 DevicesDAG 节点上的 handler。
 *
 * initialState 仅在首次调用时写入节点 state（仅补不存在的键）。
 * 写入后 node.state 自带默认值，不做运行时合并。
 * 因此 handler 内部的 ctx.state / ctx.getState() 与外部
 * dag.getNodeState(path) 返回的形状完全一致。
 *
 * 路由操作（routeToChild / stop）直接使用 DAG 标准 context 中的 helper。
 *
 * @param {{
 *   initialState?: Object,
 *   handle: import("../dag-type.js").DevicesDAGHandler | Array<{ path: string, signals: Array<Object> }>
 * }} options - 修饰节点处理器选项
 * @param {Object} [options.initialState] - 节点初始状态，首次调用时写入缺失的键
 * @param {import("../dag-type.js").DevicesDAGHandler} options.handle - 核心路由函数
 * @returns {import("../dag-type.js").DevicesDAGHandler} 可挂载到 DevicesDAG 节点上的处理器函数
 */
function createPrefixNodeHandler(options = {}) {
  const initialState = isPlainObject(options.initialState)
    ? { ...options.initialState }
    : {};
  const handle = typeof options.handle === "function" ? options.handle : null;

  if (!handle) {
    throw new TypeError("Prefix node handler requires handle().");
  }

  const needsInit = Object.keys(initialState).length > 0;
  let _initialized = false;

  return (signalPacket, context = {}) => {
    const packet = SignalPacket.from(signalPacket, {
      defaultTo: context.path ?? "/",
    });

    if (needsInit && !_initialized) {
      _initialized = true;
      context.patchState?.({ ...initialState });
    }

    return handle(packet, {
      ...context,
      state: context.getState?.() ?? {},
      getState() {
        return context.getState?.() ?? {};
      },
    });
  };
}

export { createPrefixNodeHandler };
