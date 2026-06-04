/**
 * @file 多工具修饰节点处理器（状态机路由）
 * @description 提供 createMultiToolPrefixHandler，基于 createPrefixNodeHandler 实现，
 *   通过 resolveTransition 回调决定当前信号应路由到哪个子节点、是否消费等。
 *   适合 creator/modifier handoff 等多工具链路切换场景。
 *   向上通信改用累积上下文中的回调函数，不再使用 bubble 冒泡。
 * @module core/prefixs/multi-tool-handler
 * @author Zhou Chenyu
 */

import { isPlainObject } from "./utils.js";
import { createPrefixNodeHandler } from "./handler.js";
import { SignalPacket } from "../devices-dag/signal.js";

/**
 * 创建多工具修饰节点处理器
 * @description 工厂函数，基于 createPrefixNodeHandler 构建状态机路由。
 *   通过 resolveTransition 回调接收当前信号包与状态，返回路由决策对象。
 *   支持 consume（消费不转发）、child（路由到特定子节点）、patchState（状态迁移）。
 *   需要向上通知时，通过累积上下文中的回调函数实现（不再使用 bubble）。
 * @param {{
 *   defaultChild?: string,
 *   initialState?: Object,
 *   resolveTransition: Function,
 * }} options - 多工具修饰节点路由选项
 * @param {string} [options.defaultChild=""] - 默认活动子节点名，用作 fallback
 * @param {Object} [options.initialState={}] - 额外初始状态，与 { activeChild: defaultChild } 合并
 * @param {Function} options.resolveTransition - 状态机决策函数，
 *   接收 { signalPacket, state, fromPhase, prefixContext }，
 *   返回 { child?, consume?, to?, patchState?, state?, signals? }。
 *   需要向上通知时可直接调用 prefixContext.context 中的回调函数。
 * @returns {import("../devices-dag/dag.js").DevicesDAGHandler} 可挂载到 DevicesDAG 节点上的处理器函数
 */
function createMultiToolPrefixHandler(options = {}) {
  const defaultChild =
    typeof options.defaultChild === "string" ? options.defaultChild : "";
  const resolveTransition =
    typeof options.resolveTransition === "function"
      ? options.resolveTransition
      : null;

  if (!resolveTransition) {
    throw new TypeError(
      "Multi-tool prefix handler requires resolveTransition().",
    );
  }

  return createPrefixNodeHandler({
    initialState: {
      activeChild: defaultChild,
      ...(isPlainObject(options.initialState) ? options.initialState : {}),
    },
    handle(packet, prefixContext = {}) {
      const currentState = prefixContext.state ?? {};
      const transition =
        resolveTransition({
          signalPacket: packet,
          state: currentState,
          fromPhase: currentState.phase,
          prefixContext,
        }) ?? {};

      const nextState = isPlainObject(transition.state)
        ? transition.state
        : isPlainObject(transition.patchState)
          ? { ...currentState, ...transition.patchState }
          : currentState;

      if (nextState !== currentState) {
        prefixContext.setState(nextState);
      }

      if (transition.consume === true) {
        return prefixContext.stop();
      }

      // 向上通信已改用回调（由 resolveTransition 内部调用 prefixContext.context 中的回调），
      // 不再通过 bubble / to:".." 返回信号包冒泡

      const targetChild =
        typeof transition.child === "string"
          ? transition.child
          : typeof nextState.activeChild === "string" && nextState.activeChild
            ? nextState.activeChild
            : typeof currentState.activeChild === "string" &&
                currentState.activeChild
              ? currentState.activeChild
              : defaultChild || prefixContext.defaultRoute || "";

      if (!targetChild) {
        return transition.signals
          ? { packets: [new SignalPacket("", transition.signals)] }
          : prefixContext.stop();
      }

      const to =
        typeof transition.to === "string" ? transition.to : targetChild;

      const result = prefixContext.routeToChild(
        to,
        transition.signals ?? packet.signals,
      );

      // 传递 transition 中的 context（如回调函数）到下游
      if (transition.context && typeof transition.context === "object") {
        return { ...result, context: transition.context };
      }

      return result;
    },
  });
}

export { createMultiToolPrefixHandler };
