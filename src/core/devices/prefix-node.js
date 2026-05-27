/**
 * @file 修饰节点辅助方法
 * @description 提供 prefix 语义节点的通用状态封装与多子节点路由 helper。
 * @module core/devices/prefix-node
 * @author Zhou Chenyu
 */

import { SignalPacket } from "./signal.js";

/**
 * 修饰节点常用信号类型
 * @readonly
 * @enum {string}
 */
const PREFIX_NODE_SIGNAL_TYPES = Object.freeze({
  TOOL_COMPLETE: "tool:complete",
});

/**
 * 判断值是否为纯对象
 * @param {any} value - 待判断值
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * 创建修饰节点处理器
 * @param {{
 *   initialState?: Object,
 *   handle: Function,
 * }} options - 修饰节点处理器选项
 * @returns {import("./devices-tree.js").DevicesTreeHandler}
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

/**
 * 创建多工具修饰节点处理器
 * @param {{
 *   defaultChild?: string,
 *   initialState?: Object,
 *   resolveTransition: Function,
 * }} options - 多工具修饰节点路由选项
 * @returns {import("./devices-tree.js").DevicesTreeHandler}
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

export {
  createPrefixNodeHandler,
  createMultiToolPrefixHandler,
  PREFIX_NODE_SIGNAL_TYPES,
};
