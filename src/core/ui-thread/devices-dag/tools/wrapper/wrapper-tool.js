/**
 * @file 包装器工具基座
 * @description 提供将多个子工具作为内部槽位托管的 wrapper tool 基类。
 * @module core/ui-thread/devices-dag/tools/wrapper/wrapper-tool
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../../dag-core/signal.js";
import { DevicesDAGNode } from "../../dag-core/dag-node-edge.js";
import { isPlainObject } from "../../dag-core/dag-utils.js";
import { Tool } from "../tool.js";

/**
 * 包装器工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * WrapperTool 将一组子工具托管为内部槽位（slot），每个槽位由一个
 * 不进入真实 DAG 的 shell 节点承载，wrapper 通过 {@link DevicesDAGNode#dispatch}
 * 将信号转发到目标槽位。
 *
 * 状态隔离机制：shell 节点不属于任何 DAG（`dag=null`），dispatch 时
 * handlerContext 的 state 读写降级为 shell 节点自身的 `state`，因此各槽位
 * 子工具的节点状态天然隔离。禁止用虚拟路径调真实 `dag.setNodeState` 模拟子节点。
 *
 * 可观察性约定：shell 节点不在真实 DAG 中，原 DAG 结构可观察性丢失，
 * 子类必须把可观察状态（如 phase / activeName）通过 `context.patchState`
 * 镜像到 wrapper 自己的节点 state；同时子类必须提供 `getDebugInfo()` 供调试。
 */
class WrapperTool extends Tool {
  /**
   * 子工具槽位表
   * @type {Map<string, { node: DevicesDAGNode, tool: Tool, processor: Function }>}
   */
  #slots = new Map();

  /**
   * shell 节点 id 分配计数器
   * @type {number}
   */
  #nextSlotNodeId = 0;

  /**
   * 最近一次 process/dispatch 时的 services，供完成回调使用
   * @type {Object|null}
   */
  #latestServices = null;

  /**
   * 添加一个子工具槽位
   * @description
   * 创建不进入真实 DAG 的 shell 节点，`shell.handler = tool.createProcessor()`。
   * shell 节点的 `dag` 为 null，其 dispatch 上下文的 state 读写落在 shell 节点
   * 自身 state 上，与其他槽位互不干扰。
   * @param {string} scopeId - 槽位标识
   * @param {Tool} tool - 子工具实例
   * @returns {{ node: DevicesDAGNode, tool: Tool, processor: Function }} 新建的槽位
   * @protected
   */
  _addSlot(scopeId, tool) {
    const shell = new DevicesDAGNode(this.#nextSlotNodeId++);
    const processor = tool.createProcessor();
    shell.handler = processor;

    const slot = { node: shell, tool, processor };
    this.#slots.set(scopeId, slot);
    return slot;
  }

  /**
   * 获取指定槽位
   * @param {string} scopeId - 槽位标识
   * @returns {{ node: DevicesDAGNode, tool: Tool, processor: Function }|undefined} 槽位或 undefined
   * @protected
   */
  _getSlot(scopeId) {
    return this.#slots.get(scopeId);
  }

  /**
   * 列出全部已实例化槽位的标识
   * @returns {string[]} 槽位标识列表
   * @protected
   */
  _listSlotIds() {
    return [...this.#slots.keys()];
  }

  /**
   * 读取最近一次 dispatch 时的 services
   * @returns {Object|null}
   * @protected
   */
  _resolveLatestServices() {
    return this.#latestServices;
  }

  /**
   * 将信号包分发到指定槽位
   * @description
   * services 从父上下文透传并缓存为最近一次 services（供完成回调使用）；
   * 子上下文路径为 `${parentContext.path}/${scopeId}`，仅作标识用途。
   * @param {string} scopeId - 槽位标识
   * @param {SignalPacket|Object} packet - 输入信号包
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [parentContext={}] - 父级处理器上下文
   * @returns {*} dispatch 结果
   * @protected
   */
  _dispatchToSlot(scopeId, packet, parentContext = {}) {
    const slot = this.#slots.get(scopeId);
    if (!slot) {
      return undefined;
    }

    if (parentContext?.services) {
      this.#latestServices = parentContext.services;
    }

    return slot.node.dispatch(SignalPacket.from(packet), {
      services: parentContext?.services,
      path: `${parentContext?.path ?? ""}/${scopeId}`,
    });
  }

  /**
   * 构造面向指定槽位的工具调用上下文
   * @description
   * state 读写落在槽位 shell 节点自身 state 上，services 从父上下文透传。
   * 用于在信号分发之外直接调用子工具的生命周期方法（如 `discardAction`）。
   * @param {string} scopeId - 槽位标识
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [parentContext={}] - 父级处理器上下文
   * @returns {Object} 槽位作用域上下文
   * @protected
   */
  _buildSlotContext(scopeId, parentContext = {}) {
    const slot = this.#slots.get(scopeId);
    const services = parentContext?.services ?? {};
    const path = `${parentContext?.path ?? ""}/${scopeId}`;
    if (!slot) {
      return { services, path };
    }

    const node = slot.node;
    return {
      services,
      path,
      getNodeState: () => ({ ...node.state }),
      setNodeState: (_pathOrId, state) => {
        node.state = isPlainObject(state) ? { ...state } : {};
        return { ...node.state };
      },
    };
  }

  /**
   * 销毁指定槽位
   * @param {string} scopeId - 槽位标识
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   * @protected
   */
  _disposeSlot(scopeId, context = {}) {
    const slot = this.#slots.get(scopeId);
    if (!slot) {
      return;
    }

    try {
      slot.processor.dispose?.(context);
    } catch {
      // dispose 错误不中断其余槽位清理
    }
    this.#slots.delete(scopeId);
  }

  /**
   * 销毁全部槽位
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   * @protected
   */
  _disposeAllSlots(context = {}) {
    for (const scopeId of [...this.#slots.keys()]) {
      this._disposeSlot(scopeId, context);
    }
  }

  /**
   * 工具节点被卸载时执行清理
   * @description 取消活跃动作并 dispose 全部槽位。
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
    if (this.isActionActive) {
      this.cancelAction(context);
    }
    this._disposeAllSlots(context);
  }
}

export { WrapperTool };
