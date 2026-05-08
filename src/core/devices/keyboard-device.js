/**
 * 键盘设备
 * @module core/devices/keyboard-device
 * @author Zhou Chenyu
 */

import { SignalPacket } from "./signal.js";

/**
 * 创建一棵键盘设备子树。
 * @param {{
 *   eventProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 *   keydownProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 *   keyupProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 *   repeatProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 *   cancelProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 *   keyProcessors?: Record<string, import("./devices-tree.js").DevicesTreeProcessor>,
 * }} [options={}] - 键盘设备选项
 * @returns {import("./devices-tree.js").DeviceDefinition & {
 *   resetState: () => void,
 *   getState: () => {
 *     activeKeys: Array<{
 *       code: string,
 *       key: string|null,
 *       repeat: boolean,
 *       ctrlKey: boolean,
 *       shiftKey: boolean,
 *       altKey: boolean,
 *       metaKey: boolean,
 *     }>,
 *     lastEvent: {
 *       type: string,
 *       code: string|null,
 *       key: string|null,
 *       repeat: boolean,
 *       ctrlKey: boolean,
 *       shiftKey: boolean,
 *       altKey: boolean,
 *       metaKey: boolean,
 *     }|null,
 *   },
 * }}
 */
function createKeyboardDevice(options = {}) {
  const activeKeys = new Map();
  let lastEvent = null;

  /**
   * 已配置的按键专属处理器表。
   * @type {Record<string, import("./devices-tree.js").DevicesTreeProcessor>}
   */
  const keyProcessors =
    options.keyProcessors && typeof options.keyProcessors === "object"
      ? options.keyProcessors
      : {};

  /**
   * 将节点处理结果规整为信号包数组。
   * @param {any} result - 原始处理结果
   * @returns {SignalPacket[]}
   */
  const normalizeProcessorResult = (result) =>
    SignalPacket.normalizeResult(result, { defaultTo: "/" });

  /**
   * 将原始键位编码规整为字符串或 null。
   * @param {any} code - 原始键位编码
   * @returns {string|null}
   */
  const normalizeKeyCode = (code) =>
    code === undefined || code === null ? null : String(code);

  /**
   * 将键位编码转换为安全的路径片段。
   * @param {string} code - 键位编码
   * @returns {string}
   */
  const encodeKeyPathSegment = (code) => encodeURIComponent(String(code));

  /**
   * 复制激活键状态，避免把内部可变对象直接暴露出去。
   * @param {{
   *   code: string|null,
   *   key: string|null,
   *   repeat: boolean,
   *   ctrlKey: boolean,
   *   shiftKey: boolean,
   *   altKey: boolean,
   *   metaKey: boolean,
   * }} state - 原始激活键状态
   * @returns {{
   *   code: string|null,
   *   key: string|null,
   *   repeat: boolean,
   *   ctrlKey: boolean,
   *   shiftKey: boolean,
   *   altKey: boolean,
   *   metaKey: boolean,
   * }|null}
   */
  const cloneKeyState = (state) =>
    state
      ? {
          code: state.code,
          key: state.key,
          repeat: Boolean(state.repeat),
          ctrlKey: Boolean(state.ctrlKey),
          shiftKey: Boolean(state.shiftKey),
          altKey: Boolean(state.altKey),
          metaKey: Boolean(state.metaKey),
        }
      : null;

  /**
   * 从原始信号中提取键盘事件描述。
   * @param {{type?: string, context?: Object}} signal - 输入信号
   * @returns {{
   *   type: string,
   *   code: string|null,
   *   key: string|null,
   *   repeat: boolean,
   *   ctrlKey: boolean,
   *   shiftKey: boolean,
   *   altKey: boolean,
   *   metaKey: boolean,
   * }}
   */
  const getSignalDescriptor = (signal) => {
    const context = signal?.context ?? {};
    return {
      type: String(signal?.type ?? ""),
      code: normalizeKeyCode(context.code),
      key:
        context.key === undefined || context.key === null
          ? null
          : String(context.key),
      repeat: Boolean(context.repeat),
      ctrlKey: Boolean(context.ctrlKey),
      shiftKey: Boolean(context.shiftKey),
      altKey: Boolean(context.altKey),
      metaKey: Boolean(context.metaKey),
    };
  };

  /**
   * 获取键盘设备当前状态快照。
   * @returns {{
   *   activeKeys: Array<{
   *     code: string|null,
   *     key: string|null,
   *     repeat: boolean,
   *     ctrlKey: boolean,
   *     shiftKey: boolean,
   *     altKey: boolean,
   *     metaKey: boolean,
   *   }>,
   *   lastEvent: {
   *     type: string,
   *     code: string|null,
   *     key: string|null,
   *     repeat: boolean,
   *     ctrlKey: boolean,
   *     shiftKey: boolean,
   *     altKey: boolean,
   *     metaKey: boolean,
   *   }|null,
   * }}
   */
  const getState = () => ({
    activeKeys: Array.from(activeKeys.values()).map((state) => cloneKeyState(state)),
    lastEvent: lastEvent
      ? {
          type: lastEvent.type,
          ...cloneKeyState(lastEvent),
        }
      : null,
  });

  /**
   * 根据输入包更新键盘设备内部状态。
   * @param {SignalPacket} packet - 当前信号包
   * @returns {void}
   */
  const updateStateFromPacket = (packet) => {
    for (const signal of packet.signals) {
      const descriptor = getSignalDescriptor(signal);
      lastEvent = descriptor;

      if (descriptor.type === "keydown") {
        if (!descriptor.code) continue;
        activeKeys.set(descriptor.code, descriptor);
        continue;
      }

      if (descriptor.type === "keyup" || descriptor.type === "end") {
        if (!descriptor.code) continue;
        activeKeys.delete(descriptor.code);
        continue;
      }

      if (descriptor.type === "cancel") {
        if (descriptor.code) {
          activeKeys.delete(descriptor.code);
        } else {
          activeKeys.clear();
        }
      }
    }
  };

  /**
   * 解析当前输入包应继续路由到哪些子节点。
   * @param {SignalPacket} packet - 当前信号包
   * @param {{path?: string}} [routeContext={}] - 当前路由上下文
   * @returns {Array<{to: string, signals: Array<Object>}>>}
   */
  const resolveRouteTargets = (packet, routeContext = {}) => {
    const targets = new Set();

    for (const signal of packet.signals) {
      const descriptor = getSignalDescriptor(signal);

      targets.add("event");

      if (descriptor.type === "keydown") {
        targets.add(descriptor.repeat ? "repeat" : "keydown");
      }

      if (descriptor.type === "keyup" || descriptor.type === "end") {
        targets.add("keyup");
      }

      if (descriptor.type === "cancel") {
        targets.add("cancel");
      }

      if (descriptor.code && keyProcessors[descriptor.code]) {
        targets.add(`code/${encodeKeyPathSegment(descriptor.code)}`);
      }
    }

    return Array.from(targets).map((childPath) => ({
      to: `${routeContext.path}/${childPath}`.replace(/\/+/g, "/"),
      signals: packet.signals,
    }));
  };

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
   * 处理键盘设备子树中的单个节点。
   * @param {string} nodePath - 当前节点路径
   * @param {SignalPacket} packet - 当前信号包
   * @param {{path?: string}} [routeContext={}] - 当前路由上下文
   * @returns {SignalPacket|Object|Array<Object>}
   */
  const processNodePacket = (nodePath, packet, routeContext = {}) => {
    if (nodePath === "") {
      updateStateFromPacket(packet);
      return resolveRouteTargets(packet, routeContext);
    }

    if (nodePath === "event") {
      return typeof options.eventProcessor === "function"
        ? options.eventProcessor(packet, routeContext)
        : packet;
    }

    if (nodePath === "keydown") {
      return typeof options.keydownProcessor === "function"
        ? options.keydownProcessor(packet, routeContext)
        : packet;
    }

    if (nodePath === "keyup") {
      return typeof options.keyupProcessor === "function"
        ? options.keyupProcessor(packet, routeContext)
        : packet;
    }

    if (nodePath === "repeat") {
      return typeof options.repeatProcessor === "function"
        ? options.repeatProcessor(packet, routeContext)
        : packet;
    }

    if (nodePath === "cancel") {
      return typeof options.cancelProcessor === "function"
        ? options.cancelProcessor(packet, routeContext)
        : packet;
    }

    if (nodePath.startsWith("code/")) {
      const code = decodeURIComponent(nodePath.slice("code/".length));
      const processor = keyProcessors[code];
      return typeof processor === "function" ? processor(packet, routeContext) : packet;
    }

    return packet;
  };

  return {
    /**
     * 重置键盘设备内部状态。
     * @returns {void}
     */
    resetState() {
      activeKeys.clear();
      lastEvent = null;
    },

    /**
     * 获取键盘设备当前状态快照。
     * @returns {{
     *   activeKeys: Array<{
     *     code: string|null,
     *     key: string|null,
     *     repeat: boolean,
     *     ctrlKey: boolean,
     *     shiftKey: boolean,
     *     altKey: boolean,
     *     metaKey: boolean,
     *   }>,
     *   lastEvent: {
     *     type: string,
     *     code: string|null,
     *     key: string|null,
     *     repeat: boolean,
     *     ctrlKey: boolean,
     *     shiftKey: boolean,
     *     altKey: boolean,
     *     metaKey: boolean,
     *   }|null,
     * }}
     */
    getState,

    /**
     * 定义键盘设备子树节点。
     * @returns {Array<{path: string, processor: import("./devices-tree.js").DevicesTreeProcessor}>}
     */
    defineNodes() {
      return [
        { path: "", processor: createNodeProcessor("") },
        { path: "/event", processor: createNodeProcessor("event") },
        { path: "/keydown", processor: createNodeProcessor("keydown") },
        { path: "/keyup", processor: createNodeProcessor("keyup") },
        { path: "/repeat", processor: createNodeProcessor("repeat") },
        { path: "/cancel", processor: createNodeProcessor("cancel") },
        ...Object.keys(keyProcessors).map((code) => ({
          path: `/code/${encodeKeyPathSegment(code)}`,
          processor: createNodeProcessor(`code/${encodeKeyPathSegment(code)}`),
        })),
      ];
    },
  };
}

export { createKeyboardDevice };