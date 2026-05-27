/**
 * @file 多工具修饰节点处理器（状态机路由）
 * @description 提供 createMultiToolPrefixHandler，基于 createPrefixNodeHandler 实现，
 *   通过 resolveTransition 回调决定当前信号应路由到哪个子节点、是否消费、是否冒泡等。
 *   适合 creator/modifier handoff 等多工具链路切换场景。
 * @module core/prefix/multi-tool-handler
 * @author Zhou Chenyu
 */

import { isPlainObject } from "./utils.js";
import { createPrefixNodeHandler } from "./handler.js";

/**
 * 创建多工具修饰节点处理器
 * @description 工厂函数，基于 createPrefixNodeHandler 构建状态机路由。
 *   通过 resolveTransition 回调接收当前信号包与状态，返回路由决策对象。
 *   支持 consume（消费不转发）、bubble（向上冒泡）、child（路由到特定子节点）、patchState（状态迁移）。
 * @param {{
 *   defaultChild?: string,
 *   initialState?: Object,
 *   resolveTransition: Function,
 * }} options - 多工具修饰节点路由选项
 * @param {string} [options.defaultChild=""] - 默认活动子节点名，用作 fallback
 * @param {Object} [options.initialState={}] - 额外初始状态，与 { activeChild: defaultChild } 合并
 * @param {Function} options.resolveTransition - 状态机决策函数，接收 { signalPacket, state, prefixContext }，返回路由决策对象
 * @returns {import("../devices/devices-tree.js").DevicesTreeHandler} 可挂载到 DevicesTree 节点上的处理器函数
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
        return [];
      }

      if (transition.bubble === true) {
        return {
          to: typeof transition.to === "string" ? transition.to : "..",
          signals: transition.signals ?? packet.signals,
        };
      }

      const targetChild =
        typeof transition.child === "string"
          ? transition.child
          : typeof nextState.activeChild === "string" && nextState.activeChild
            ? nextState.activeChild
            : typeof currentState.activeChild === "string" &&
                currentState.activeChild
              ? currentState.activeChild
              : defaultChild || prefixContext.eventContext?.defaultChild || "";

      if (!targetChild) {
        return transition.signals ? { signals: transition.signals } : [];
      }

      return {
        to: typeof transition.to === "string" ? transition.to : targetChild,
        signals: transition.signals ?? packet.signals,
      };
    },
  });
}

export { createMultiToolPrefixHandler };
