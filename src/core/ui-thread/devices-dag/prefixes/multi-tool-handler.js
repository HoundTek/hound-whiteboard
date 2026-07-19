/**
 * @file 多工具修饰节点处理器（状态机路由）
 * @description
 * 提供 createMultiToolPrefixHandler，基于 createPrefixNodeHandler 实现，
 * 通过 resolveTransition 回调决定当前信号应路由到哪个子节点、是否消费等。
 * 适合 creator/modifier handoff 等多工具链路切换场景。
 * 下游控制参数通过 `acc` 传递，不再依赖 bubble 冒泡。
 * @module core/ui-thread/devices-dag/prefixes/multi-tool-handler
 * @author Zhou Chenyu
 */

import { isPlainObject } from "./utils.js";
import { createPrefixNodeHandler } from "./handler.js";

/**
 * resolveTransition 的返回值
 * @description 路由决策对象，控制当前信号包的去向和行为。
 * @typedef {Object} MultiToolTransitionResult
 * @property {string} [child] - 目标子节点名，覆盖 state.activeChild
 * @property {boolean} [consume] - 设为 true 时消费信号，不继续转发
 * @property {string} [to] - 显式覆盖路由路径，仍只指向后代节点
 * @property {Object} [patchState] - 浅合并到当前节点状态
 * @property {Object} [state] - 直接替换当前节点状态（优先级高于 patchState）
 * @property {Array<Object>} [signals] - 改写下发的信号列表
 * @property {Object} [acc] - 追加到下游累积上下文的键值对
 */

/**
 * resolveTransition 接收的入参
 * @description 每次信号包到达时，由框架收集并提供给决策函数。
 * @typedef {Object} MultiToolResolveParams
 * @property {import("../devices-dag/signal.js").SignalPacket} signalPacket - 当前已规整的输入信号包
 * @property {Object} state - 当前节点状态快照（含 activeChild、phase 等）
 * @property {string|undefined} fromPhase - 当前阶段，即 state.phase
 * @property {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} prefixContext - DAG 处理器上下文，含 setState、routeToChild、stop、delNodeState、services 及 acc
 */

/**
 * 创建多工具修饰节点处理器
 * @description
 * 工厂函数，基于 createPrefixNodeHandler 构建状态机路由。
 * 通过 resolveTransition 回调接收当前信号包与状态，返回路由决策对象。
 * 支持 consume（消费不转发）、child（路由到特定子节点）、patchState（状态迁移）。
 * 需要控制下游时，可通过 acc 传递运行时参数（不再使用 bubble）。
 * @param {Object} options - 多工具修饰节点路由选项
 * @param {string} [options.defaultChild=""] - 默认活动子节点名，用作 fallback
 * @param {Object} [options.initialState={}] - 额外初始状态，与 { activeChild: defaultChild } 合并
 * @param {(params: MultiToolResolveParams) => MultiToolTransitionResult} options.resolveTransition - 状态机决策函数
 * @returns {import("../devices-dag/dag-type.js").DevicesDAGHandler} 可挂载到 DevicesDAG 节点上的处理器函数
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

  /**
   * 状态机路由处理函数
   * @param {import("../devices-dag/signal.js").SignalPacket} packet - 已规整的输入信号包
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} prefixContext - DAG 处理器上下文
   * @returns {import("../devices-dag/dag-type.js").DevicesDAGHandlerResult}
   */
  return createPrefixNodeHandler({
    initialState: {
      activeChild: defaultChild,
      ...(isPlainObject(options.initialState) ? options.initialState : {}),
    },
    handle(packet, prefixContext = {}) {
      /** @type {Object} */
      const currentState = prefixContext.state ?? {};

      /** @type {MultiToolTransitionResult} */
      const transition =
        resolveTransition({
          signalPacket: packet,
          state: currentState,
          fromPhase: currentState.phase,
          prefixContext,
        }) ?? {};

      // 状态合并：transition.state 全量替换，patchState 浅合并，否则保持
      const nextState = isPlainObject(transition.state)
        ? transition.state
        : isPlainObject(transition.patchState)
          ? { ...currentState, ...transition.patchState }
          : currentState;

      if (nextState !== currentState) {
        prefixContext.setState(nextState);
      }

      // consume 模式：信号在此终止，不继续向下路由
      if (transition.consume === true) {
        return prefixContext.stop();
      }

      // 目标子节点优先级：transition.child > nextState.activeChild > currentState.activeChild > defaultChild > prefixContext.defaultRoute
      const targetChild =
        typeof transition.child === "string"
          ? transition.child
          : typeof nextState.activeChild === "string" && nextState.activeChild
            ? nextState.activeChild
            : typeof currentState.activeChild === "string" &&
                currentState.activeChild
              ? currentState.activeChild
              : defaultChild || prefixContext.defaultRoute || "";

      // 无有效子节点时退化为空路由或消费
      if (!targetChild) {
        return transition.signals
          ? prefixContext.routeToChild("", transition.signals)
          : prefixContext.stop();
      }

      const to =
        typeof transition.to === "string" ? transition.to : targetChild;

      const result = prefixContext.routeToChild(
        to,
        transition.signals ?? packet.signals,
      );

      // 将 transition.acc 传递到下游子节点
      const nextAcc = isPlainObject(transition.acc) ? transition.acc : null;
      if (nextAcc) {
        return { ...result, acc: nextAcc };
      }

      return result;
    },
  });
}

export { createMultiToolPrefixHandler };
