/**
 * @file 触摸屏设备
 * @description 提供触摸输入信号的设备图节点创建与处理接口。
 * @module core/ui-thread/devices-dag/devices/touchscreen-device
 * @author Zhou Chenyu
 */

/**
 * 触摸屏设备子图定义
 * @typedef {import("../../devices-dag/dag-type.js").SubDAGDefinition & {
 *   clearTouches: () => void,
 *   getActiveTouches: () => Array<{touchId: string, position: any}>,
 * }} TouchscreenSubDAGDefinition
 */

import { createSubDAG } from "../index.js";
import { SignalPacket } from "../dag-core/signal.js";
import { SIGNAL_TYPES } from "../dag-core/signal-types.js";
import { DEVICE_DEFAULT_ROUTE } from "./constant.js";

/**
 * 创建一张触摸屏设备子图
 * @returns {TouchscreenSubDAGDefinition}
 */
function createTouchscreenDevice() {
  const activeTouches = new Map();
  let lastChangedTouchIds = [];

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
   * 从信号中解析触点 id
   * @param {{context?: Object}} signal - 输入信号
   * @returns {string|null}
   */
  const getTouchId = (signal) => {
    const context = signal?.context ?? {};
    const touchId = context.touchId ?? context.pointerId ?? context.contactId;
    return touchId === undefined || touchId === null ? null : String(touchId);
  };

  /**
   * 从信号中读取位置值
   * @param {{context?: Object}} signal - 输入信号
   * @returns {any}
   */
  const getSignalPosition = (signal) => {
    const context = signal?.context ?? {};
    return context.value ?? context.position ?? null;
  };

  /**
   * 获取当前活动触点列表
   * @returns {Array<{touchId: string, position: any}>}
   */
  const getActiveTouches = () =>
    Array.from(activeTouches.entries()).map(([touchId, position]) => ({
      touchId,
      position: clonePosition(position),
    }));

  /**
   * 根据输入包更新当前活动触点集合
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
  };

  /**
   * 根节点处理器
   * @description
   * 1. 将 position 信号的 canvas 相对坐标转为世界坐标
   * 2. 更新内部触点状态
   * 3. 路由到 contacts 子节点输出聚合的触点报告
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../dag-type.js").DevicesDAGHandlerContext} [ctx={}] - 处理上下文（含 services.viewport）
   * @returns {import("../dag-type.js").DevicesDAGHandlerResult}
   */
  const rootHandler = (signalPacket, ctx = {}) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "/" });

    const viewport = ctx?.services?.viewport;
    const convertedSignals =
      viewport && typeof viewport.convertCanvasSignalsToWorld === "function"
        ? viewport.convertCanvasSignalsToWorld(packet.signals)
        : packet.signals;

    const convertedPacket = new SignalPacket(packet.to, convertedSignals);
    updateTouches(convertedPacket);
    return ctx.routeToChild(ctx.defaultRoute || "", convertedPacket.signals);
  };

  /**
   * 触点报告处理器
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../dag-type.js").DevicesDAGHandlerContext} [ctx={}] - 当前路由上下文
   * @returns {import("../dag-type.js").DevicesDAGHandlerResult}
   */
  const contactsHandler = (signalPacket, ctx = {}) => {
    const packet = SignalPacket.from(signalPacket, { defaultTo: "/" });
    const contacts = getActiveTouches();
    return ctx.routeToChild(ctx.defaultRoute || "", [
      ctx.signal(SIGNAL_TYPES.TOUCH_CONTACTS, undefined, {
        contacts,
        changedTouchIds: [...lastChangedTouchIds],
        activeTouchIds: contacts.map((contact) => contact.touchId),
      }),
    ]);
  };

  const builder = createSubDAG("/touchscreen");
  const root = builder.node().handler(rootHandler).defaultRoute("contacts");
  const contacts = builder
    .node()
    .handler(contactsHandler)
    .defaultRoute(DEVICE_DEFAULT_ROUTE);
  builder.edge("contacts", root, contacts);

  return builder
    .expose({
      clearTouches() {
        activeTouches.clear();
        lastChangedTouchIds = [];
      },
      getActiveTouches,
    })
    .build();
}

export { createTouchscreenDevice };
