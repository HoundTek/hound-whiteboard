/**
 * @file 鼠标设备
 * @description 提供鼠标输入信号的设备树节点创建与处理接口。
 * @module core/devices/mouse-device
 * @author Zhou Chenyu
 */

import { SignalPacket } from "./signal.js";

/**
 * 创建一棵鼠标设备子树。
 * @param {{
 *   pointerProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 *   primaryProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 *   secondaryProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 *   auxiliaryProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 *   wheelProcessor?: import("./devices-tree.js").DevicesTreeProcessor,
 * }} [options={}] - 鼠标设备选项
 * @returns {import("./devices-tree.js").DeviceDefinition & {
 *   resetState: () => void,
 *   getState: () => {
 *     activeButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
 *     lastPosition: any,
 *     lastWheelDelta: {deltaX: number, deltaY: number, deltaZ: number}|null,
 *   },
 * }}
 */
function createMouseDevice(options = {}) {
  let activeButtons = {
    primary: false,
    secondary: false,
    auxiliary: false,
  };
  let lastPosition = null;
  let lastWheelDelta = null;

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
   * 将节点处理结果规整为信号包数组。
   * @param {any} result - 原始处理结果
   * @returns {SignalPacket[]}
   */
  const normalizeProcessorResult = (result) =>
    SignalPacket.normalizeResult(result);

  /**
   * 鼠标按钮位掩码表。
   * @type {{primary: number, secondary: number, auxiliary: number}}
   */
  const BUTTON_MASKS = {
    primary: 1,
    secondary: 2,
    auxiliary: 4,
  };

  /**
   * 将按钮编号映射为设备内部通道名。
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
   * 根据 buttons 位掩码推导当前按钮状态。
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
   * 获取设备当前状态快照。
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
   * 判断一个信号包中是否包含指定类型的信号。
   * @param {SignalPacket} packet - 当前信号包
   * @param {string} type - 目标信号类型
   * @returns {boolean}
   */
  const hasSignalType = (packet, type) =>
    packet.signals.some((signal) => signal.type === type);

  /**
   * 根据输入包更新鼠标设备的内部状态。
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
   * 解析当前输入包应继续路由到哪些子节点。
   * @param {SignalPacket} packet - 当前信号包
   * @param {{path?: string}} routeContext - 当前路由上下文
   * @param {{
   *   previousButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
   *   nextButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
   *   endedChannels: Set<string>,
   * }} routeState - 路由决策所需的状态快照
   * @returns {Array<{to: string, signals: Array<Object>}>>}
   */
  const resolveRouteTargets = (packet, routeContext, routeState) => {
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
   * 处理鼠标设备子树中的单个节点。
   * @param {string} nodePath - 当前节点路径
   * @param {SignalPacket} packet - 当前信号包
   * @param {{path?: string}} [routeContext={}] - 当前路由上下文
   * @returns {SignalPacket|Object|Array<Object>}
   */
  const processNodePacket = (nodePath, packet, routeContext = {}) => {
    if (nodePath === "") {
      return resolveRouteTargets(
        packet,
        routeContext,
        updateStateFromPacket(packet),
      );
    }

    return packet;
  };

  const channelProcessors = {
    pointer:
      typeof options.pointerProcessor === "function"
        ? options.pointerProcessor
        : null,
    primary:
      typeof options.primaryProcessor === "function"
        ? options.primaryProcessor
        : null,
    secondary:
      typeof options.secondaryProcessor === "function"
        ? options.secondaryProcessor
        : null,
    auxiliary:
      typeof options.auxiliaryProcessor === "function"
        ? options.auxiliaryProcessor
        : null,
    wheel:
      typeof options.wheelProcessor === "function"
        ? options.wheelProcessor
        : null,
  };

  return {
    /**
     * 重置鼠标设备内部状态。
     * @returns {void}
     */
    resetState() {
      activeButtons = {
        primary: false,
        secondary: false,
        auxiliary: false,
      };
      lastPosition = null;
      lastWheelDelta = null;
    },

    /**
     * 获取鼠标设备当前状态快照。
     * @returns {{
     *   activeButtons: {primary: boolean, secondary: boolean, auxiliary: boolean},
     *   lastPosition: any,
     *   lastWheelDelta: {deltaX: number, deltaY: number, deltaZ: number}|null,
     * }}
     */
    getState,

    /**
     * 定义鼠标设备子树节点。
     * @returns {Array<{path: string, defaultPath?: string, processor: import("./devices-tree.js").DevicesTreeProcessor|null}>}
     */
    defineNodes() {
      const channelNodes = [
        "pointer",
        "primary",
        "secondary",
        "auxiliary",
        "wheel",
      ];

      return [
        { path: "", processor: createNodeProcessor("") },
        ...channelNodes.flatMap((channel) => {
          return [
            {
              path: `/${channel}`,
              processor: channelProcessors[channel],
              defaultPath: "tool",
            },
          ];
        }),
      ];
    },
  };
}

export { createMouseDevice };
