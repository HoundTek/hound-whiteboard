/**
 * @file 基础修饰节点处理器
 * @description
 * 提供 createPrefixNodeHandler，是所有修饰节点的根基。
 * 它封装了状态读写、前缀上下文 helper（routeTo / routeToChild / bubbleToParent / stop），
 * 让调用方只需在 handle() 中编写路由逻辑。
 * @module core/prefixs/handler
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../devices/signal.js";
import { isPlainObject } from "./utils.js";

/**
 * 创建修饰节点处理器
 * @description
 * 工厂函数，生成可挂载到 DevicesTree 节点上的 handler。
 * 封装了节点状态读写（getState / setState / patchState）和路由 helper（routeTo / routeToChild / bubbleToParent / stop），
 * 调用方只需在 handle() 中编写业务路由逻辑，无需重复状态初始化与包规整。
 * @param {{
 *   initialState?: Object,
 *   handle: Function,
 * }} options - 修饰节点处理器选项
 * @param {Object} [options.initialState] - 节点初始状态，挂载后第一次读取时与节点现有 state 合并
 * @param {Function} options.handle - 核心路由函数，接收 (packet, prefixContext) 参数
 * @returns {import("../devices/devices-tree.js").DevicesTreeHandler} 可挂载到 DevicesTree 节点上的处理器函数
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
      defaultTo: context.eventContext?.path ?? "/",
    });
    const nodePath = context.eventContext?.path ?? "/";
    const readState = () => {
      const currentState = context.getNodeState?.(nodePath);
      return isPlainObject(currentState)
        ? { ...initialState, ...currentState }
        : { ...initialState };
    };
    const writeState = (nextState = {}) => {
      const normalizedState = isPlainObject(nextState) ? nextState : {};
      return (
        context.setNodeState?.(nodePath, normalizedState) ?? normalizedState
      );
    };

    return handle(packet, {
      ...context,
      state: readState(),
      getState: readState,
      setState: writeState,
      patchState(partialState = {}) {
        const nextState = isPlainObject(partialState)
          ? { ...readState(), ...partialState }
          : readState();
        return writeState(nextState);
      },
      routeTo(to, signals = packet.signals) {
        return { to, signals };
      },
      routeToChild(childName, signals = packet.signals) {
        return { to: childName, signals };
      },
      bubbleToParent(signals = packet.signals, to = "..") {
        return { to, signals };
      },
      stop() {
        return [];
      },
    });
  };
}

export { createPrefixNodeHandler };
