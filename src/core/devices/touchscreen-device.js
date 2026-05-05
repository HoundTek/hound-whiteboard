/**
 * 触摸屏设备
 * @module core/devices/touchscreen-device
 * @author Zhou Chenyu
 */

import { SignalPacket } from "./signal.js";

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

  const normalizeProcessorResult = (result) =>
    SignalPacket.normalizeResult(result, { defaultTo: "/" });

  const clonePosition = (position) => {
    if (position && typeof position === "object") {
      return Array.isArray(position) ? [...position] : { ...position };
    }
    return position;
  };

  const getTouchId = (signal) => {
    const context = signal?.context ?? {};
    const touchId = context.touchId ?? context.pointerId ?? context.contactId;
    return touchId === undefined || touchId === null ? null : String(touchId);
  };

  const getSignalPosition = (signal) => {
    const context = signal?.context ?? {};
    return context.value ?? context.position ?? null;
  };

  const getActiveTouches = () =>
    Array.from(activeTouches.entries()).map(([touchId, position]) => ({
      touchId,
      position: clonePosition(position),
    }));

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
      updateTouches(packet);
      return {
        to: `${routeContext.path}/contacts`.replace(/\/+/g, "/"),
        signals: packet.signals,
      };
    }

    if (nodePath === "contacts") {
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
    }

    return packet;
  };

  return {
    clearTouches() {
      activeTouches.clear();
      lastChangedTouchIds = [];
    },

    getActiveTouches,

    defineNodes() {
      return [
        { path: "", processor: createNodeProcessor("") },
        { path: "/contacts", processor: createNodeProcessor("contacts") },
      ];
    },
  };
}

export { createTouchscreenDevice, TOUCHSCREEN_DEVICE_SIGNAL_TYPES };