/**
 * @file 多工具并发的 wrapper
 * @description 将一条多指输入流按 touchId 分流为多个独立子图的泛型包装器。
 * @module core/ui-thread/devices-dag/tools/multi-tool-wrapper
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../signal.js";
import { Tool } from "./tool.js";
import { DevicesDAGNode } from "../dag-node-edge.js";
import { TOUCHSCREEN_DEVICE_SIGNAL_TYPES } from "../devices/touchscreen-device.js";

/**
 * 多工具并发包装工具
 * @class
 * @extends Tool
 * @description
 * 接收 touchscreen device 输出的 `touch-contacts` 信号，为每个 touchId
 * 创建一个独立的子图入口节点并通过 {@link DevicesDAGNode#dispatch} 沿边路由信号。
 * 子图的生命周期与触点同步：
 *
 * - 新触点 → 新建入口节点，送第一个 position 信号
 * - 触点移动 → 送 position 信号
 * - 触点抬起 → 送 end 信号，销毁节点
 *
 * 目的是在设备图保持静态（不动态挂载/卸载节点）的前提下实现多指并发。
 *
 * @example
 * // 单工具 per touch：工厂函数包装 Tool 成节点
 * const multiStroke = new MultiToolWrapper((touchId) => {
 *   const entry = new DevicesDAGNode(0);
 *   entry.handler = new StrokeCreatorTool({
 *     property: { color: "#ff0000", width: 2 },
 *   }).createProcessor();
 *   return entry;
 * });
 *
 * @example
 * // 多节点 per touch：工厂函数构建多节点子图
 * const multiHandoff = new MultiToolWrapper((touchId) => {
 *   const entry = new DevicesDAGNode(0);
 *   const chooser = new DevicesDAGNode(1);
 *   // ... setup edges ...
 *   return entry;
 * });
 */
class MultiToolWrapper extends Tool {
  /**
   * 触点到入口节点的工厂函数
   * @type {(touchId: string) => DevicesDAGNode}
   */
  #entryFactory;

  /**
   * touchId 到会话信息的映射
   * @type {Map<string, { sessionId: number, entry: DevicesDAGNode, createdAt: number }>}
   */
  #instances = new Map();

  /**
   * 会话 id 分配计数器
   * @type {number}
   */
  #nextSessionId = 0;

  /**
   * @param {(touchId: string) => DevicesDAGNode} entryFactory - 入口节点工厂函数，每次新触点时调用返回入口节点
   */
  constructor(entryFactory) {
    super();
    this.#entryFactory = entryFactory;
  }

  /**
   * 获取当前活跃触点数量
   * @description 供外部调试与 tool-switcher 等编排模块观察当前并发会话数。
   * @returns {number}
   */
  getActiveTouchCount() {
    return this.#instances.size;
  }

  /**
   * 获取会话调试信息
   * @description 返回当前活跃会话的摘要列表，供调试观察。
   * @returns {Array<{ touchId: string, sessionId: number, createdAt: number }>}
   */
  getSessionDebugInfo() {
    return Array.from(this.#instances.entries()).map(([touchId, session]) => ({
      touchId,
      sessionId: session.sessionId,
      createdAt: session.createdAt,
    }));
  }

  /**
   * 处理 touch-contacts 信号，将每个触点分发给对应的子图
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [deviceContext={}] - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);

    const firstSignal = packet.signals?.[0];

    // 处理 end-action 信号（外部强制结束，如 tool-switcher 切换）
    if (firstSignal?.type === "end-action") {
      return this.endAction(deviceContext);
    }

    if (
      !firstSignal ||
      firstSignal.type !== TOUCHSCREEN_DEVICE_SIGNAL_TYPES.CONTACTS
    ) {
      return;
    }

    const { contacts, changedTouchIds } = firstSignal.context ?? {};
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
   * 构造子图 dispatch 所需的上下文选项
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext|Object} [context={}] - 外层设备上下文
   * @returns {Object}
   */
  #buildDispatchContext(context = {}) {
    const dispatchContext = {};

    if (context.services) {
      dispatchContext.services = context.services;
    }
    if (context.routeContext) {
      dispatchContext.routeContext = context.routeContext;
    }
    if (!context.services && !context.routeContext && context.acc) {
      dispatchContext.acc = context.acc;
    }

    return dispatchContext;
  }

  /**
   * 新建触点——创建入口节点并走边路由信号
   * @param {string} touchId - 触点 id
   * @param {{touchId: string, position: any}} contact - 触点信息
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  #beginTouch(touchId, contact, deviceContext) {
    const isFirstTouch = this.#instances.size === 0;

    const entry = this.#entryFactory(touchId);
    const sessionId = this.#nextSessionId++;
    this.#instances.set(touchId, {
      sessionId,
      entry,
      createdAt: Date.now(),
    });

    if (isFirstTouch) {
      this.beginAction(deviceContext);
    }

    const packet = new SignalPacket("", [
      { type: "position", context: { value: contact.position } },
    ]);
    entry.dispatch(packet, this.#buildDispatchContext(deviceContext));
  }

  /**
   * 更新触点——向已有子图入口发送新位置
   * @param {string} touchId - 触点 id
   * @param {{touchId: string, position: any}} contact - 触点信息
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  #updateTouch(touchId, contact, deviceContext) {
    const session = this.#instances.get(touchId);
    if (!session) return;
    const entry = session.entry;

    const packet = new SignalPacket("", [
      { type: "position", context: { value: contact.position } },
    ]);
    entry.dispatch(packet, this.#buildDispatchContext(deviceContext));
  }

  /**
   * 触点抬起——结束手势并清理子图
   * @param {string} touchId - 触点 id
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  #endTouch(touchId, deviceContext) {
    const session = this.#instances.get(touchId);
    if (!session) return;
    const entry = session.entry;

    const packet = new SignalPacket("", [{ type: "end", context: {} }]);
    entry.dispatch(packet, this.#buildDispatchContext(deviceContext));

    // 清理入口节点 handler 的外部资源（如 overlay）
    this.#disposeNode(entry, deviceContext);
    this.#instances.delete(touchId);

    if (this.#instances.size === 0 && this.isActionActive) {
      this.completeAction(deviceContext);
    }
  }

  /**
   * 递归清理节点 handler 的 dispose 钩子
   * @param {DevicesDAGNode} node - 当前节点
   * @param {Object} deviceContext - 设备上下文
   * @param {Set<number>} [visited=new Set()] - 已访问节点 id
   */
  #disposeNode(node, deviceContext, visited = new Set()) {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);

    const handler = node.handler;
    if (typeof handler?.dispose === "function") {
      try {
        handler.dispose(deviceContext);
      } catch {
        // 静默吞掉 dispose 错误
      }
    }

    for (const edge of node.outEdges.values()) {
      this.#disposeNode(edge.target, deviceContext, visited);
    }
  }

  /**
   * 动作开始
   * @description 首个触点到达时触发。外部 tool-switcher 也可通过此方法同步状态。
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}]
   * @returns {void}
   */
  beginAction(context = {}) {
    super.beginAction(context);
  }

  /**
   * 动作完成（提交所有子工具结果）
   * @description 最后一个触点抬起时自动触发；外部 tool-switcher 也可通过此方法强制结束。
   * 向所有活跃子图发送 end 信号，然后递归清理。
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}]
   * @returns {void}
   */
  completeAction(context = {}) {
    for (const [, session] of this.#instances) {
      const entry = session.entry;
      const packet = new SignalPacket("", [{ type: "end", context: {} }]);
      entry.dispatch(packet, this.#buildDispatchContext(context));
      this.#disposeNode(entry, context);
    }
    this.#instances.clear();
    this.isActionActive = false;
  }

  /**
   * 动作取消（丢弃所有子工具结果）
   * @description 向所有活跃子图发送 cancel 信号，然后递归清理并重置。
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}]
   * @returns {void}
   */
  cancelAction(context = {}) {
    for (const [, session] of this.#instances) {
      const entry = session.entry;
      const packet = new SignalPacket("", [{ type: "cancel", context: {} }]);
      entry.dispatch(packet, this.#buildDispatchContext(context));
      this.#disposeNode(entry, context);
    }
    this.#instances.clear();
    this.isActionActive = false;
  }

  /**
   * 优雅结束当前动作
   * @description 向所有活跃子图发送 end 信号并清理。
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}]
   * @returns {void}
   */
  endAction(context = {}) {
    if (this.#instances.size > 0 || this.isActionActive) {
      this.completeAction(context);
    }
  }

  /**
   * 重置所有子图实例
   * @returns {void}
   */
  reset() {
    this.#instances.clear();
    this.#nextSessionId = 0;
    this.isActionActive = false;
  }
}

export { MultiToolWrapper };
