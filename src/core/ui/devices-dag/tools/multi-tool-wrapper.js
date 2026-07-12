/**
 * @file 多工具并发的 wrapper
 * @description 将一条多指输入流按 touchId 分流为多个独立工具实例的泛型包装器。
 * @module core/ui/devices-dag/tools/multi-tool-wrapper
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../signal.js";
import { Tool } from "./tool.js";
import { TOUCHSCREEN_DEVICE_SIGNAL_TYPES } from "../devices/touchscreen-device.js";

/**
 * 多工具并发包装工具
 * @class
 * @extends Tool
 * @description
 * 接收 touchscreen device 输出的 `touch-contacts` 信号，为每个 touchId
 * 创建一个独立的工具实例并转发信号。工具实例的生命周期与触点同步：
 *
 * - 新触点 → 新建工具实例，送第一个 position 信号
 * - 触点移动 → 送 position 信号
 * - 触点抬起 → 送 end 信号，销毁实例
 *
 * 目的是在设备图保持静态（不动态挂载/卸载节点）的前提下实现多指并发。
 *
 * @example
 * ```js
 * const multiStroke = new MultiToolWrapper((touchId) => {
 *   return new StrokeCreatorTool({
 *     property: { color: "#ff0000", width: 2 },
 *   });
 * });
 * ```
 */
class MultiToolWrapper extends Tool {
  /**
   * 触点到工具实例的工厂函数
   * @type {(touchId: string) => Tool}
   */
  #toolFactory;

  /**
   * touchId 到工具实例的映射
   * @type {Map<string, Tool>}
   */
  #instances = new Map();

  /**
   * @param {(touchId: string) => Tool} toolFactory - 工具工厂函数，每次新触点时调用返回工具实例
   */
  constructor(toolFactory) {
    super();
    this.#toolFactory = toolFactory;
  }

  /**
   * 处理 touch-contacts 信号，将每个触点分发给对应的工具实例
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [deviceContext={}] - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);

    const touchSignal = packet.signals?.[0];
    if (
      !touchSignal ||
      touchSignal.type !== TOUCHSCREEN_DEVICE_SIGNAL_TYPES.CONTACTS
    ) {
      return;
    }

    const { contacts, changedTouchIds } = touchSignal.context ?? {};
    if (!changedTouchIds || changedTouchIds.length === 0) {
      return;
    }

    for (const touchId of changedTouchIds) {
      const contact = contacts?.find((c) => c.touchId === touchId);

      if (!contact) {
        this.#endTouch(touchId, deviceContext);
        continue;
      }

      if (!this.#instances.has(touchId)) {
        this.#beginTouch(touchId, contact, deviceContext);
      } else {
        this.#updateTouch(touchId, contact, deviceContext);
      }
    }
  }

  /**
   * 新建触点——创建工具实例并发起手势
   * @param {string} touchId - 触点 id
   * @param {{touchId: string, position: any}} contact - 触点信息
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  #beginTouch(touchId, contact, deviceContext) {
    const instance = this.#toolFactory(touchId);
    this.#instances.set(touchId, instance);

    const packet = new SignalPacket("/", [
      { type: "position", context: { value: contact.position } },
    ]);
    instance.process(packet, deviceContext);
  }

  /**
   * 更新触点——向已有工具实例发送新位置
   * @param {string} touchId - 触点 id
   * @param {{touchId: string, position: any}} contact - 触点信息
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  #updateTouch(touchId, contact, deviceContext) {
    const instance = this.#instances.get(touchId);
    if (!instance) return;

    const packet = new SignalPacket("/", [
      { type: "position", context: { value: contact.position } },
    ]);
    instance.process(packet, deviceContext);
  }

  /**
   * 触点抬起——结束手势并销毁工具实例
   * @param {string} touchId - 触点 id
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  #endTouch(touchId, deviceContext) {
    const instance = this.#instances.get(touchId);
    if (!instance) return;

    const packet = new SignalPacket("/", [
      { type: "end", context: {} },
    ]);
    instance.process(packet, deviceContext);
    this.#instances.delete(touchId);
  }

  /**
   * 重置所有工具实例
   * @returns {void}
   */
  reset() {
    for (const instance of this.#instances.values()) {
      instance.reset();
    }
    this.#instances.clear();
  }
}

export { MultiToolWrapper };
