/**
 * @file 键盘设备
 * @description 提供键盘输入信号的设备图节点创建与处理接口。
 * @module core/ui/devices/keyboard-device
 * @author Zhou Chenyu
 */

import { createSubDAG, SignalPacket } from "../index.js";
import { DEVICE_DEFAULT_ROUTE, STANDARD_KEYBOARD_CODES } from "./constant.js";

const KEYBOARD_DEVICE_SIGNAL_TYPES = {
  TRIGGER: "trigger",
  TRIGGER_REPEAT: "trigger-repeat",
  RELEASE: "release",
  CANCEL: "cancel",
};

/**
 * 创建一张键盘设备子图
 * @description
 * 仅按活跃键位列表预创建 code 节点；所有 code 节点的 defaultRoute 统一为 "default"。
 * 不再接受 processor / nodeConfigs 等定制参数——设备只负责信号产出，路由由外部通过边级 prefix 完成。
 * @returns {import("../devices-dag/dag.js").SubDAGDefinition & {
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
 * @author Zhou Chenyu
 */
function createKeyboardDevice() {
  const activeKeys = new Map();
  let lastEvent = null;

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

    if (descriptor.type === "keydown" && descriptor.repeat) {
      return {
        type: KEYBOARD_DEVICE_SIGNAL_TYPES.TRIGGER_REPEAT,
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

  const builder = createSubDAG("/keyboard");
  const root = builder.node().handler(rootHandler);

  const eventNode = builder.node();
  const keydownNode = builder.node();
  const keyupNode = builder.node();
  const repeatNode = builder.node();
  const cancelNode = builder.node();

  builder.edge("event", root, eventNode);
  builder.edge("keydown", root, keydownNode);
  builder.edge("keyup", root, keyupNode);
  builder.edge("repeat", root, repeatNode);
  builder.edge("cancel", root, cancelNode);

  // 预创建 code 节点，统一 defaultRoute = "default"
  const codeRoot = builder.node();
  builder.edge("code", root, codeRoot);

  for (const code of STANDARD_KEYBOARD_CODES) {
    const segment = encodeKeyPathSegment(String(code));
    const codeNode = builder.node().defaultRoute(DEVICE_DEFAULT_ROUTE);
    builder.edge(segment, codeRoot, codeNode);
  }

  return builder
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
