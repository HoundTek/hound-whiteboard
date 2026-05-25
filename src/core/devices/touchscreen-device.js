/**
 * @file 触摸屏设备
 * @description 提供触摸输入信号的设备树节点创建与处理接口。
 * @module core/devices/touchscreen-device
 * @author Zhou Chenyu
 */

import { SignalPacket } from "./signal.js";

/**
 * 触摸屏设备输出信号类型。
 * @type {{CONTACTS: string}}
 */
const TOUCHSCREEN_DEVICE_SIGNAL_TYPES = Object.freeze({
  CONTACTS: "touch-contacts",
});

/**
 * 创建一棵触摸屏设备子树。
 * @param {{onUpdate?: Function}} [options={}] - 触摸屏设备选项
 * @returns {import("./devices-tree.js").DeviceDefinition & {
 *   clearTouches: () => void,
 *   getActiveTouches: () => Array<{touchId: string, position: any}>,
 * }}
 */
function createTouchscreenDevice(options = {}) {
  const activeTouches = new Map();
  const onUpdate =
    typeof options.onUpdate === "function" ? options.onUpdate : null;
  let lastChangedTouchIds = [];

  /**
   * 将节点处理结果规整为信号包数组。
   * @param {any} result - 原始处理结果
   * @returns {SignalPacket[]}
   */
  const normalizeProcessorResult = (result) =>
    SignalPacket.normalizeResult(result);

  /**
   * 复制位置值，避免把可变对象直接暴露到设备外部。
   * @param {any} position - 原始位置值
   * @returns {any}
   */
  const clonePosition = (position) => {
    if (position && typeof position === "object") {
      return Array.isArray(position) ? [...position] : { ...position };
    }
    return position;
  };

  /**
   * 从信号中解析触点 id。
   * @param {{context?: Object}} signal - 输入信号
   * @returns {string|null}
   */
  const getTouchId = (signal) => {
    const context = signal?.context ?? {};
    const touchId = context.touchId ?? context.pointerId ?? context.contactId;
    return touchId === undefined || touchId === null ? null : String(touchId);
  };

  /**
   * 从信号中读取位置值。
   * @param {{context?: Object}} signal - 输入信号
   * @returns {any}
   */
  const getSignalPosition = (signal) => {
    const context = signal?.context ?? {};
    return context.value ?? context.position ?? null;
  };

  /**
   * 获取当前活动触点列表。
   * @returns {Array<{touchId: string, position: any}>}
   */
  const getActiveTouches = () =>
    Array.from(activeTouches.entries()).map(([touchId, position]) => ({
      touchId,
      position: clonePosition(position),
    }));

  /**
   * 根据输入包更新当前活动触点集合。
   * @param {SignalPacket} packet - 当前信号包
   * @returns {void}
   */
  const updateTouches = (packet) => {
    const changedTouchIds = [];

    for (const signal of packet.signals) {
      const touchId = getTouchId(signal);
      if (!touchId) continue;

      if (signal.type === "position") {
        const position = getSignalPosition(signal);
        if (position === null || position === undefined) continue;
        activeTouches.set(touchId, clonePosition(position));
        changedTouchIds.push(touchId);
        continue;
      }

      if (signal.type === "end" || signal.type === "cancel") {
        activeTouches.delete(touchId);
        changedTouchIds.push(touchId);
      }
    }

    lastChangedTouchIds = Array.from(new Set(changedTouchIds));
    onUpdate?.({
      contacts: getActiveTouches(),
      changedTouchIds: [...lastChangedTouchIds],
      activeTouchIds: Array.from(activeTouches.keys()),
    });
  };

  const rootProcessor = (signalPacket) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "/" });
    updateTouches(packet);
    return normalizeProcessorResult({
      signals: packet.signals,
    });
  };

  const contactsPacketRewriter = (signalPacket, routeContext = {}) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "/" });
    const contacts = getActiveTouches();
    return {
      to: routeContext.path,
      signals: [
        {
          type: TOUCHSCREEN_DEVICE_SIGNAL_TYPES.CONTACTS,
          context: {
            contacts,
            changedTouchIds: [...lastChangedTouchIds],
            activeTouchIds: contacts.map((contact) => contact.touchId),
          },
        },
      ],
    };
  };

  return {
    /**
     * 清空当前活动触点状态。
     * @returns {void}
     */
    clearTouches() {
      activeTouches.clear();
      lastChangedTouchIds = [];
    },

    /**
     * 获取当前活动触点列表。
     * @returns {Array<{touchId: string, position: any}>}
     */
    getActiveTouches,

    /**
     * 定义触摸屏设备子树节点。
     * @returns {Array<{path: string, processor: import("./devices-tree.js").DevicesTreeProcessor}>}
     */
    defineNodes() {
      return [
        {
          path: "",
          processor: rootProcessor,
          defaultPath: "contacts",
        },
        { path: "/contacts", rewritePacket: contactsPacketRewriter },
      ];
    },
  };
}

export { createTouchscreenDevice, TOUCHSCREEN_DEVICE_SIGNAL_TYPES };
