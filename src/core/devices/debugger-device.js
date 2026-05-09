/**
 * 调试设备
 * @module core/devices/debugger-device
 * @author Zhou Chenyu
 */

import { SignalPacket } from "./signal.js";
import { joinPath } from "../utils/path.js";

/**
 * 调试设备输出信号类型。
 * @type {{REPORT: string}}
 */
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

  /**
   * 将节点处理结果规整为信号包数组。
   * @param {any} result - 原始处理结果
   * @returns {SignalPacket[]}
   */
  const normalizeProcessorResult = (result) =>
    SignalPacket.normalizeResult(result);

  /**
   * 创建一条调试历史记录。
   * @param {SignalPacket} packet - 当前信号包
   * @param {{path?: string}} [routeContext={}] - 当前路由上下文
   * @returns {{index: number, receivedAt: string, packet: SignalPacket}}
   */
  const createHistoryEntry = (packet, routeContext = {}) => ({
    index: history.length,
    receivedAt: routeContext.path ?? "/",
    packet: new SignalPacket(packet.to, [...packet.signals]),
  });

  /**
   * 为指定节点创建可挂载的处理器。
   * @param {string} nodePath - 设备内相对节点路径
   * @returns {import("./devices-tree.js").DevicesTreeProcessor}
   */
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

  /**
   * 处理设备子树中的单个节点。
   * @param {string} nodePath - 当前节点路径
   * @param {SignalPacket} packet - 当前信号包
   * @param {{path?: string}} [routeContext={}] - 当前路由上下文
   * @returns {SignalPacket|Object}
   */
  const processNodePacket = (nodePath, packet, routeContext = {}) => {
    if (nodePath === "") {
      const entry = createHistoryEntry(packet, routeContext);
      history.push(entry);
      onRecord?.(entry);

      return {
        to: joinPath(routeContext.path ?? "/", "report"),
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

    /**
     * 清空当前调试历史。
     * @returns {void}
     */
    clearHistory() {
      history.length = 0;
    },

    /**
     * 获取最近一条调试历史。
     * @returns {Object|null}
     */
    getLastEntry() {
      return history[history.length - 1] ?? null;
    },

    /**
     * 定义调试设备子树节点。
     * @returns {Array<{path: string, processor: import("./devices-tree.js").DevicesTreeProcessor}>}
     */
    defineNodes() {
      return [
        { path: "", processor: createNodeProcessor("") },
        { path: "/report", processor: createNodeProcessor("report") },
      ];
    },
  };
}

export { createDebuggerDevice, DEBUGGER_DEVICE_SIGNAL_TYPES };
