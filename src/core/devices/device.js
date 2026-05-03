/**
 * @file 设备基类
 * @module core/device/device
 * @author Zhou Chenyu
 */

import { Tool } from "../tools/tool.js";
import { EventBus } from "../utils/event-bus.js";

const DEVICE_EVENTS = Object.freeze({
  RECEIVE_PACKET: "device.receive",
  EMIT_PACKET: "device.emit",
});

class Device {
  /**
   * 设备名称
   * @type {string}
   */
  name;

  /**
   * 设备路径
   * @type {string}
   */
  path;

  /**
   * 设备事件总线
   * @type {EventBus}
   */
  eventBus;

  constructor({ name, path = "", eventBus } = {}) {
    this.name = name ?? this.name ?? this.constructor.name;
    this.path = path;
    this.eventBus = eventBus ?? new EventBus();
    this.toolChain = [];
  }

  /**
   * 设备的工具链
   * @type {Tool[]}
   */
  toolChain = [];

  /**
   * 获取当前工具链中的最后一个工具，即正在使用的工具
   * @return {Tool} 当前工具
   */
  get currentTool() {
    return this.toolChain[this.toolChain.length - 1];
  }

  /**
   * 将工具添加到工具链中
   * @param {Tool} tool - 要添加的工具
   * @return {Tool} 添加后的当前工具
   */
  toolPush(tool) {
    this.toolChain.push(tool);
    return tool;
  }

  /**
   * 从工具链中移除最后一个工具
   * @returns {Tool} 移除后的当前工具
   */
  toolPop() {
    this.toolChain.pop();
    return this.currentTool;
  }

  /**
   * 订阅设备事件。
   * @param {string} eventName - 事件名
   * @param {Function} handler - 监听器
   * @returns {Function} 取消订阅函数
   */
  on(eventName, handler) {
    return this.eventBus.on(eventName, handler);
  }

  /**
   * 取消订阅设备事件。
   * @param {string} eventName - 事件名
   * @param {Function} handler - 监听器
   * @returns {boolean} 是否成功移除
   */
  off(eventName, handler) {
    return this.eventBus.off(eventName, handler);
  }

  /**
   * 订阅一次设备事件。
   * @param {string} eventName - 事件名
   * @param {Function} handler - 监听器
   * @returns {Function} 取消订阅函数
   */
  once(eventName, handler) {
    return this.eventBus.once(eventName, handler);
  }

  /**
   * 处理并传输一个信号包。
   * @param {{to?: string, signals?: Array<Object>}} signalPacket - 输入信号包
   * @param {Object} routeContext - 路由上下文
   * @returns {Array<{to: string, signals: Array<Object>}>} 输出信号包列表
   */
  processSignalPacket(signalPacket, routeContext = {}) {
    const normalizedPacket = Tool.normalizeSignalPacket(signalPacket);

    this.eventBus.emit(DEVICE_EVENTS.RECEIVE_PACKET, {
      device: this,
      signalPacket: normalizedPacket,
      routeContext,
    });

    let packets = [normalizedPacket];
    for (const tool of this.toolChain) {
      packets = packets.flatMap((packet) =>
        Tool.normalizeProcessResult(
          tool.process(packet, {
            ...routeContext,
            device: this,
            currentTool: tool,
            toolChain: this.toolChain,
          }),
        ),
      );
    }

    this.eventBus.emit(DEVICE_EVENTS.EMIT_PACKET, {
      device: this,
      signalPackets: packets,
      routeContext,
    });

    return packets;
  }

  /**
   * 对外暴露的信号传输入口。
   * @param {{to?: string, signals?: Array<Object>}} signalPacket - 输入信号包
   * @param {Object} routeContext - 路由上下文
   * @returns {Array<{to: string, signals: Array<Object>}>} 输出信号包列表
   */
  transmit(signalPacket, routeContext = {}) {
    return this.processSignalPacket(signalPacket, routeContext);
  }
}

export {
  Device,
  DEVICE_EVENTS,
};
