/**
 * @file 调试设备
 * @description 提供调试设备节点与信号记录功能。
 * @module core/devices/debugger-device
 * @author Zhou Chenyu
 */

import { createSubTree } from "./devices-tree.js";
import { createPrefixNodeHandler } from "./prefix-node.js";
import { SignalPacket } from "./signal.js";

/**
 * 调试设备输出信号类型
 * @type {{REPORT: string}}
 */
const DEBUGGER_DEVICE_SIGNAL_TYPES = Object.freeze({
  REPORT: "debug-report",
});

/**
 * 创建一棵调试设备子树
 * @description
 * 创建一个用于记录和报告信号包历史的调试设备子树
 * @param {{onRecord?: Function}} [options={}] - 调试设备选项
 * @returns {import("./devices-tree.js").SubTreeDefinition & {
 *   history: Array<Object>,
 *   clearHistory: () => void,
 *   getLastEntry: () => Object|null,
 * }}
 */
function createDebuggerDevice(options = {}) {
  const history = [];
  const onRecord =
    typeof options.onRecord === "function" ? options.onRecord : null;

  /**
   * 创建一条调试历史记录
   * @param {SignalPacket} packet - 当前信号包
   * @param {import("./devices-tree.js").DevicesTreeHandlerContext} [context={}] - 当前路由上下文
   * @returns {{index: number, receivedAt: string, packet: SignalPacket}}
   */
  const createHistoryEntry = (packet, context = {}) => ({
    index: history.length,
    receivedAt: context.eventContext?.path ?? "/",
    packet: new SignalPacket(packet.to, [...packet.signals]),
  });

  /**
   * 根节点处理器
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("./devices-tree.js").DevicesTreeHandlerContext} [context={}] - 当前路由上下文
   * @returns {Object}
   */
  const rootHandler = createPrefixNodeHandler({
    initialState: {
      lastEntryIndex: -1,
    },
    handle(signalPacket, prefixContext = {}) {
      const packet = SignalPacket.from(signalPacket, { defaultTo: "/" });
      const entry = createHistoryEntry(packet, prefixContext);
      history.push(entry);
      prefixContext.patchState({
        lastEntryIndex: entry.index,
      });
      onRecord?.(entry);

      return prefixContext.routeToChild("report", packet.signals);
    },
  });

  /**
   * 报告节点处理器
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("./devices-tree.js").DevicesTreeHandlerContext} [context={}] - 当前路由上下文
   * @returns {Object}
   */
  const reportHandler = (signalPacket, context = {}) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "/" });
    const lastEntry = history[history.length - 1] ?? null;
    return {
      to: context.eventContext?.path,
      signals: [
        {
          type: DEBUGGER_DEVICE_SIGNAL_TYPES.REPORT,
          context: {
            index: lastEntry?.index ?? -1,
            receivedAt:
              lastEntry?.receivedAt ?? context.eventContext?.path ?? packet.to,
            originalTo: lastEntry?.packet?.to ?? packet.to,
            signalCount:
              lastEntry?.packet?.signals?.length ?? packet.signals.length,
          },
        },
      ],
    };
  };

  const debuggerDevice = createSubTree("/debugger")
    .node("")
    .prefix(rootHandler, {
      prefixKind: "debug",
      routePolicy: "inspect",
    })
    .defaultChild("report")
    .end()
    .node("report")
    .handler(reportHandler)
    .end()
    .expose({
      clearHistory() {
        history.length = 0;
      },

      getLastEntry() {
        return history[history.length - 1] ?? null;
      },
    })
    .build();

  debuggerDevice.history = history;
  return debuggerDevice;
}

export { createDebuggerDevice, DEBUGGER_DEVICE_SIGNAL_TYPES };
