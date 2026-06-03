/**
 * @file 鼠标设备
 * @description 提供鼠标输入信号的设备图节点创建与处理接口。
 * @module core/devices/mouse-device
 * @author Zhou Chenyu
 */

import { createSubDAG, SignalPacket } from "../devices-dag/index.js";
import { DEVICE_DEFAULT_ROUTE } from "./constant.js";

/**
 * 创建一张鼠标设备子图
 * @description
 * 五个通道路由节点（pointer / primary / secondary / auxiliary / wheel）
 * 均只设 defaultRoute = "default"，不再接受外部 processor 定制。
 * @returns {import("../devices-dag/dag.js").SubDAGDefinition & {
 *   resetState: () => void,
 *   getState: () => {
 *     activeButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
 *     lastPosition: any,
 *     lastWheelDelta: {deltaX: number, deltaY: number, deltaZ: number}|null,
 *   },
 * }}
 * @author Zhou Chenyu
 */
function createMouseDevice() {
  let activeButtons = {
    primary: false,
    secondary: false,
    auxiliary: false,
  };
  let lastPosition = null;
  let lastWheelDelta = null;

  /**
   * 复制位置值，避免把可变对象直接暴露到设备外部
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
   * 鼠标按钮位掩码表
   * @type {{primary: number, secondary: number, auxiliary: number}}
   */
  const BUTTON_MASKS = {
    primary: 1,
    secondary: 2,
    auxiliary: 4,
  };

  /**
   * 将按钮编号映射为设备内部通道名
   * @param {number|string} button - DOM 或业务侧按钮编号
   * @returns {"primary"|"secondary"|"auxiliary"|null}
   */
  const buttonIndexToChannel = (button) => {
    if (button === 0 || button === "primary") return "primary";
    if (button === 2 || button === "secondary") return "secondary";
    if (button === 1 || button === "middle" || button === "auxiliary") {
      return "auxiliary";
    }
    return null;
  };

  /**
   * 根据 buttons 位掩码推导当前按钮状态
   * @param {number} buttonsValue - DOM buttons 位掩码
   * @param {{primary: boolean, secondary: boolean, auxiliary: boolean}} [fallback=activeButtons] - 无法解析时的回退状态
   * @returns {{primary: boolean, secondary: boolean, auxiliary: boolean}}
   */
  const getButtonsState = (buttonsValue, fallback = activeButtons) => {
    if (typeof buttonsValue !== "number") {
      return { ...fallback };
    }
    return {
      primary: (buttonsValue & BUTTON_MASKS.primary) === BUTTON_MASKS.primary,
      secondary:
        (buttonsValue & BUTTON_MASKS.secondary) === BUTTON_MASKS.secondary,
      auxiliary:
        (buttonsValue & BUTTON_MASKS.auxiliary) === BUTTON_MASKS.auxiliary,
    };
  };

  /**
   * 获取设备当前状态快照
   * @returns {{
   *   activeButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
   *   lastPosition: any,
   *   lastWheelDelta: {deltaX: number, deltaY: number, deltaZ: number}|null,
   * }}
   */
  const getState = () => ({
    activeButtons: { ...activeButtons },
    lastPosition: clonePosition(lastPosition),
    lastWheelDelta: lastWheelDelta ? { ...lastWheelDelta } : null,
  });

  /**
   * 判断一个信号包中是否包含指定类型的信号
   * @param {SignalPacket} packet - 当前信号包
   * @param {string} type - 目标信号类型
   * @returns {boolean}
   */
  const hasSignalType = (packet, type) =>
    packet.signals.some((signal) => signal.type === type);

  /**
   * 根据输入包更新鼠标设备的内部状态
   * @param {SignalPacket} packet - 当前信号包
   * @returns {{
   *   previousButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
   *   nextButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
   *   endedChannels: Set<string>,
   * }}
   */
  const updateStateFromPacket = (packet) => {
    const previousButtons = { ...activeButtons };
    let nextButtons = { ...activeButtons };
    const endedChannels = new Set();

    for (const signal of packet.signals) {
      if (signal.type === "position" || signal.type === "wheel") {
        const position = signal?.context?.value ?? signal?.context?.position;
        if (position !== undefined && position !== null) {
          lastPosition = clonePosition(position);
        }

        nextButtons = getButtonsState(signal?.context?.buttons, nextButtons);

        if (signal.type === "wheel") {
          lastWheelDelta = {
            deltaX: signal?.context?.deltaX ?? 0,
            deltaY: signal?.context?.deltaY ?? 0,
            deltaZ: signal?.context?.deltaZ ?? 0,
          };
        }
      }

      if (signal.type === "end" || signal.type === "cancel") {
        nextButtons = getButtonsState(signal?.context?.buttons, nextButtons);
        const endedChannel = buttonIndexToChannel(signal?.context?.button);
        if (endedChannel) {
          nextButtons[endedChannel] = false;
          endedChannels.add(endedChannel);
        }
      }
    }

    activeButtons = nextButtons;
    return { previousButtons, nextButtons, endedChannels };
  };

  /**
   * 解析当前输入包应继续路由到哪些子节点
   * @param {SignalPacket} packet - 当前信号包
   * @param {{
   *   previousButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
   *   nextButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
   *   endedChannels: Set<string>,
   * }} routeState - 路由决策所需的状态快照
   * @returns {Array<{to: string, signals: Array<Object>}>}
   */
  const resolveRouteTargets = (packet, routeState) => {
    const targets = [];

    if (hasSignalType(packet, "position")) {
      targets.push("pointer");
    }

    if (hasSignalType(packet, "wheel")) {
      targets.push("wheel");
    }

    for (const [channel, path] of Object.entries({
      primary: "primary",
      secondary: "secondary",
      auxiliary: "auxiliary",
    })) {
      if (
        routeState.previousButtons[channel] ||
        routeState.nextButtons[channel] ||
        routeState.endedChannels.has(channel)
      ) {
        targets.push(path);
      }
    }

    return Array.from(new Set(targets)).map((childPath) => ({
      to: childPath,
      signals: packet.signals,
    }));
  };

  /**
   * 解析显式指定的下行目标，保留调用方已经选定的子路径。
   * @param {SignalPacket} packet
   * @param {{ path?: string }} [ctx={}]
   * @returns {string}
   */
  const resolveExplicitDescendantPath = (packet, ctx = {}) => {
    const packetTo = typeof packet?.to === "string" ? packet.to : "";
    const currentPath = typeof ctx?.path === "string" ? ctx.path : "";
    if (!packetTo) return "";
    if (!packetTo.startsWith("/")) return packetTo;
    if (!currentPath || packetTo === currentPath) return "";
    const prefix = `${currentPath}/`;
    return packetTo.startsWith(prefix) ? packetTo.slice(prefix.length) : "";
  };

  /**
   * 根节点处理器
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} [context={}] - handler context
   * @returns {Array<SignalPacket|Object>}
   */
  const rootHandler = (signalPacket, context = {}) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "/" });
    const nextPackets = resolveRouteTargets(
      packet,
      updateStateFromPacket(packet),
    );
    const explicitDescendantPath = resolveExplicitDescendantPath(
      packet,
      context,
    );
    if (
      explicitDescendantPath &&
      !nextPackets.some((entry) => entry.to === explicitDescendantPath)
    ) {
      nextPackets.push({
        to: explicitDescendantPath,
        signals: packet.signals,
      });
    }
    return nextPackets;
  };

  const builder = createSubDAG("/mouse");
  const root = builder.node().handler(rootHandler);

  const pointer = builder.node().defaultRoute(DEVICE_DEFAULT_ROUTE);
  const primary = builder.node().defaultRoute(DEVICE_DEFAULT_ROUTE);
  const secondary = builder.node().defaultRoute(DEVICE_DEFAULT_ROUTE);
  const auxiliary = builder.node().defaultRoute(DEVICE_DEFAULT_ROUTE);
  const wheel = builder.node().defaultRoute(DEVICE_DEFAULT_ROUTE);

  builder.edge("pointer", root, pointer);
  builder.edge("primary", root, primary);
  builder.edge("secondary", root, secondary);
  builder.edge("auxiliary", root, auxiliary);
  builder.edge("wheel", root, wheel);

  return builder
    .expose({
      resetState() {
        activeButtons = {
          primary: false,
          secondary: false,
          auxiliary: false,
        };
        lastPosition = null;
        lastWheelDelta = null;
      },
      getState,
    })
    .build();
}

export { createMouseDevice };
