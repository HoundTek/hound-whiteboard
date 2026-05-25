/**
 * @file 键盘设备
 * @description 提供键盘输入信号的设备树节点创建与处理接口。
 * @module core/devices/keyboard-device
 * @author Zhou Chenyu
 */

import { createDevice } from "./devices-tree.js";
import { SignalPacket } from "./signal.js";
import { joinPath } from "../utils/path.js";

const KEYBOARD_DEVICE_SIGNAL_TYPES = {
  TRIGGER: "trigger",
  RELEASE: "release",
  CANCEL: "cancel",
};

/**
 * 创建一棵键盘设备子树
 * @param {{
 *   eventProcessor?: import("./devices-tree.js").DevicesTreeHandler,
 *   keydownProcessor?: import("./devices-tree.js").DevicesTreeHandler,
 *   keyupProcessor?: import("./devices-tree.js").DevicesTreeHandler,
 *   repeatProcessor?: import("./devices-tree.js").DevicesTreeHandler,
 *   cancelProcessor?: import("./devices-tree.js").DevicesTreeHandler,
 *   nodeConfigs?: Record<string, {
 *     handler?: import("./devices-tree.js").DevicesTreeHandler,
 *     defaultChild?: string,
 *   }>,
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

  const rawNodeConfigs =
    options.nodeConfigs && typeof options.nodeConfigs === "object"
      ? options.nodeConfigs
      : {};

  /**
   * 将原始键位编码规整为字符串或 null
   * @param {any} code - 原始键位编码
   * @returns {string|null}
   */
  const normalizeKeyCode = (code) =>
    code === undefined || code === null ? null : String(code);

  /**
   * 将键位编码转换为安全的路径片段
   * @param {string} code - 键位编码
   * @returns {string}
   */
  const encodeKeyPathSegment = (code) => encodeURIComponent(String(code));

  /**
   * 规整设备内部节点路径 key
   * @param {string} nodePath - 原始节点路径
   * @returns {string}
   */
  const normalizeNodePathKey = (nodePath = "") => {
    if (!nodePath || nodePath === "/") return "";
    return joinPath(nodePath).slice(1);
  };

  /**
   * 将原始键盘信号改写为工具消费信号
   * @param {{type?: string, context?: Object}} signal - 当前原始信号
   * @returns {Object|null}
   */
  const rewriteToolSignal = (signal) => {
    const descriptor = getSignalDescriptor(signal);

    if (descriptor.type === "keydown" && !descriptor.repeat) {
      return {
        type: KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER,
        context: {
          ...signal.context,
          sourceType: descriptor.type,
        },
      };
    }

    if (descriptor.type === "keyup" || descriptor.type === "end") {
      return {
        type: KEYBOARD_DEVICE_SIGNAL_TYPES.RELEASE,
        context: {
          ...signal.context,
          sourceType: descriptor.type,
        },
      };
    }

    if (descriptor.type === "cancel") {
      return {
        type: KEYBOARD_DEVICE_SIGNAL_TYPES.CANCEL,
        context: {
          ...signal.context,
          sourceType: descriptor.type,
        },
      };
    }

    return null;
  };

  /**
   * 复制激活键状态，避免把内部可变对象直接暴露出去
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
   * 从原始信号中提取键盘事件描述
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
   * 获取键盘设备当前状态快照
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
    activeKeys: Array.from(activeKeys.values()).map((state) =>
      cloneKeyState(state),
    ),
    lastEvent: lastEvent
      ? {
          type: lastEvent.type,
          ...cloneKeyState(lastEvent),
        }
      : null,
  });

  /**
   * 根据输入包更新键盘设备内部状态
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
   * 解析当前输入包应继续路由到哪些子节点
   * @param {SignalPacket} packet - 当前信号包
   * @returns {Array<{to: string, signals: Array<Object>}>}
   */
  const resolveRouteTargets = (packet) => {
    const generalTargets = new Set();
    const codeTargets = new Map();

    for (const signal of packet.signals) {
      const descriptor = getSignalDescriptor(signal);

      generalTargets.add("event");

      if (descriptor.type === "keydown") {
        generalTargets.add(descriptor.repeat ? "repeat" : "keydown");
      }

      if (descriptor.type === "keyup" || descriptor.type === "end") {
        generalTargets.add("keyup");
      }

      if (descriptor.type === "cancel") {
        generalTargets.add("cancel");
      }

      if (descriptor.code) {
        const toolSignal = rewriteToolSignal(signal);
        if (toolSignal) {
          const codePath = `code/${encodeKeyPathSegment(descriptor.code)}`;
          if (!codeTargets.has(codePath)) {
            codeTargets.set(codePath, []);
          }
          codeTargets.get(codePath).push(toolSignal);
        }
      }
    }

    return [
      ...Array.from(generalTargets).map((childPath) => ({
        to: childPath,
        signals: packet.signals,
      })),
      ...Array.from(codeTargets.entries()).map(([childPath, signals]) => ({
        to: childPath,
        signals,
      })),
    ];
  };

  /**
   * 处理键盘设备根节点输入
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @returns {Array<{to: string, signals: Array<Object>}>}
   */
  const rootHandler = (signalPacket) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "/" });
    updateStateFromPacket(packet);
    return resolveRouteTargets(packet);
  };

  const keyboardDeviceBuilder = createDevice("/keyboard")
    .node("")
    .handler(rootHandler)
    .end()
    .node("event")
    .handler(
      typeof options.eventProcessor === "function"
        ? options.eventProcessor
        : null,
    )
    .end()
    .node("keydown")
    .handler(
      typeof options.keydownProcessor === "function"
        ? options.keydownProcessor
        : null,
    )
    .end()
    .node("keyup")
    .handler(
      typeof options.keyupProcessor === "function"
        ? options.keyupProcessor
        : null,
    )
    .end()
    .node("repeat")
    .handler(
      typeof options.repeatProcessor === "function"
        ? options.repeatProcessor
        : null,
    )
    .end()
    .node("cancel")
    .handler(
      typeof options.cancelProcessor === "function"
        ? options.cancelProcessor
        : null,
    )
    .end()
    .node("tools")
    .end();

  for (const [nodePath, config] of Object.entries(rawNodeConfigs)) {
    keyboardDeviceBuilder
      .node(normalizeNodePathKey(nodePath))
      .handler(typeof config?.handler === "function" ? config.handler : null)
      .defaultChild(
        typeof config?.defaultChild === "string" ? config.defaultChild : "",
      )
      .end();
  }

  return keyboardDeviceBuilder
    .expose({
      resetState() {
        activeKeys.clear();
        lastEvent = null;
      },
      getState,
    })
    .build();
}

export { KEYBOARD_DEVICE_SIGNAL_TYPES, createKeyboardDevice };
