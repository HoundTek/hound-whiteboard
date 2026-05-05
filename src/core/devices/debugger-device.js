/**
 * 调试设备
 * @module core/devices/debugger-device
 * @author Zhou Chenyu
 */

import { SignalPacket } from "./signal.js";

const DEBUGGER_DEVICE_SIGNAL_TYPES = Object.freeze({
  REPORT: "debug-report",
});

/**
 * 创建一棵调试设备子树。
 * @param {{onRecord?: Function}} [options={}] - 调试设备选项
 * @returns {import("./devices-tree.js").DeviceDefinition & {
 *   history: Array<Object>,
 *   clearHistory: () => void,
 *   getLastEntry: () => Object|null,
 * }}
 */
function createDebuggerDevice(options = {}) {
  const history = [];
  const onRecord =
    typeof options.onRecord === "function" ? options.onRecord : null;

  const normalizeProcessorResult = (result) =>
    SignalPacket.normalizeResult(result, { defaultTo: "/" });

  const createHistoryEntry = (packet, routeContext = {}) => ({
    index: history.length,
    receivedAt: routeContext.path ?? "/",
    packet: new SignalPacket(packet.to, [...packet.signals]),
  });

  const createNodeProcessor =
    (nodePath) =>
    (signalPacket, routeContext = {}) =>
      normalizeProcessorResult(
        processNodePacket(
          nodePath,
          SignalPacket.from(signalPacket, { defaultTo: "/" }),
          routeContext,
        ),
      );

  const processNodePacket = (nodePath, packet, routeContext = {}) => {
    if (nodePath === "") {
      const entry = createHistoryEntry(packet, routeContext);
      history.push(entry);
      onRecord?.(entry);

      return {
        to: `${routeContext.path}/report`.replace(/\/+/g, "/"),
        signals: packet.signals,
      };
    }

    if (nodePath === "report") {
      const lastEntry = history[history.length - 1] ?? null;
      return {
        to: routeContext.path,
        signals: [
          {
            type: DEBUGGER_DEVICE_SIGNAL_TYPES.REPORT,
            context: {
              index: lastEntry?.index ?? -1,
              receivedAt: lastEntry?.receivedAt ?? routeContext.path,
              originalTo: lastEntry?.packet?.to ?? packet.to,
              signalCount:
                lastEntry?.packet?.signals?.length ?? packet.signals.length,
            },
          },
        ],
      };
    }

    return packet;
  };

  return {
    history,

    clearHistory() {
      history.length = 0;
    },

    getLastEntry() {
      return history[history.length - 1] ?? null;
    },

    defineNodes() {
      return [
        { path: "", processor: createNodeProcessor("") },
        { path: "/report", processor: createNodeProcessor("report") },
      ];
    },
  };
}

export { createDebuggerDevice, DEBUGGER_DEVICE_SIGNAL_TYPES };
