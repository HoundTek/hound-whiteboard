/**
 * @file 工具切换包装工具
 * @description 将 1-of-N 互斥工具路由封装为单个 wrapper tool。
 * @module core/ui-thread/devices-dag/tools/wrapper/switcher-wrapper
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../../dag-core/signal.js";
import { SIGNAL_TYPES } from "../../dag-core/signal-types.js";
import { WrapperTool } from "./wrapper-tool.js";

/**
 * 工具切换包装工具
 * @class
 * @extends WrapperTool
 * @description
 * 1-of-N 互斥路由：接收按钮组设备的 `tool-switch` 信号切换活跃工具，
 * 其余信号（鼠标 position/end 等）转发到当前活跃工具槽位。
 *
 * 与旧 prefix 子图实现不同，子工具作为 wrapper 内部槽位托管：
 * - `tool` 实例在构造时即实例化槽位
 * - `createTool` 工厂在首次激活时才实例化槽位（懒实例化，面向千级工具场景）
 *
 * 当前路由目标通过 `context.patchState` 以 `routeTarget` 键镜像到
 * wrapper 自己的节点 state，供外部观察。
 *
 * @example
 * const switcher = new ToolSwitcherWrapper({
 *   tools: [
 *     { name: "stroke", tool: strokeTool },
 *     { name: "circle", createTool: () => new CircleDataCreatorTool({ processor: createCircleRadiusProcessor() }) },
 *   ],
 *   defaultTool: "stroke",
 * });
 */
class ToolSwitcherWrapper extends WrapperTool {
  /**
   * 工具条目表（名称 → 实例或工厂）
   * @type {Map<string, { tool: Tool|null, createTool: (() => Tool)|null }>}
   */
  #entries = new Map();

  /**
   * 当前活跃工具名
   * @type {string}
   */
  #activeName;

  /**
   * 默认工具名
   * @type {string}
   */
  #defaultName;

  /**
   * 最近一次镜像到节点 state 的路由目标
   * @type {string|null}
   */
  #lastMirroredName = null;

  /**
   * @param {{
   *   tools: Array<{ name: string, tool?: Tool, createTool?: () => Tool }>,
   *   defaultTool: string,
   * }} options - 工具切换配置
   * @param {Array<{ name: string, tool?: Tool, createTool?: () => Tool }>} options.tools - 工具条目列表，`tool` 与 `createTool` 二选一
   * @param {string} options.defaultTool - 默认路由目标（必传，无默认值——初始路由是接线决策），必须在 tools 列表中
   * @throws {TypeError} 条目缺少 name、tool/createTool 未正确二选一、tool 不是 Tool 实例，或 defaultTool 缺失/不在 tools 列表中时抛出
   */
  constructor({ tools = [], defaultTool } = {}) {
    super();

    if (!Array.isArray(tools) || tools.length === 0) {
      throw new TypeError(
        "ToolSwitcherWrapper requires a non-empty tools list.",
      );
    }

    for (const entry of tools) {
      const { name, tool, createTool } = entry ?? {};
      if (typeof name !== "string" || !name) {
        throw new TypeError(
          "ToolSwitcherWrapper: every tool entry requires a non-empty name.",
        );
      }
      if (this.#entries.has(name)) {
        throw new TypeError(
          `ToolSwitcherWrapper: duplicate tool name "${name}".`,
        );
      }

      const hasTool = tool != null;
      const hasFactory = typeof createTool === "function";
      if (hasTool === hasFactory) {
        throw new TypeError(
          `ToolSwitcherWrapper: entry "${name}" must provide exactly one of tool / createTool.`,
        );
      }
      if (hasTool && typeof tool.createProcessor !== "function") {
        throw new TypeError(
          `ToolSwitcherWrapper: entry "${name}" tool must be a Tool instance.`,
        );
      }

      this.#entries.set(name, {
        tool: hasTool ? tool : null,
        createTool: hasFactory ? createTool : null,
      });

      // 实例条目立即建槽；工厂条目等首次激活时懒实例化
      if (hasTool) {
        this._addSlot(name, tool);
      }
    }

    if (typeof defaultTool !== "string" || !defaultTool) {
      throw new TypeError(
        "ToolSwitcherWrapper requires a non-empty defaultTool option.",
      );
    }
    if (!this.#entries.has(defaultTool)) {
      throw new TypeError(
        `ToolSwitcherWrapper: defaultTool "${defaultTool}" is not in the tools list.`,
      );
    }

    this.#defaultName = defaultTool;
    this.#activeName = defaultTool;
  }

  /**
   * 确保指定工具的槽位已实例化
   * @description `createTool` 工厂条目在首次激活时调用并建槽。
   * @param {string} name - 工具名
   * @returns {{ node: import("../../dag-core/dag-node-edge.js").DevicesDAGNode, tool: Tool, processor: Function }|undefined} 槽位或 undefined
   */
  #ensureSlot(name) {
    const existing = this._getSlot(name);
    if (existing) {
      return existing;
    }

    const entry = this.#entries.get(name);
    if (!entry) {
      return undefined;
    }

    const tool = entry.tool ?? entry.createTool?.();
    if (!tool || typeof tool.createProcessor !== "function") {
      throw new TypeError(
        `ToolSwitcherWrapper: createTool for "${name}" did not return a Tool instance.`,
      );
    }

    entry.tool = tool;
    return this._addSlot(name, tool);
  }

  /**
   * 处理一个完整信号包
   * @description
   * `tool-switch` 信号（携带 `context.activeTool`）切换路由目标：
   * 校验目标在工具列表中，先确保新槽位实例化，再对旧工具调用
   * `endAction` 完成其手头动作；该信号不再向下转发。
   * 其他信号转发到当前活跃槽位，并按需镜像 `routeTarget` 到节点 state。
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, context = {}) {
    const packet = SignalPacket.from(signalPacket);

    const switchSignal = packet.signals.find(
      (signal) => signal?.type === SIGNAL_TYPES.TOOL_SWITCH,
    );

    if (switchSignal) {
      const target = switchSignal.context?.activeTool;
      if (
        typeof target === "string" &&
        this.#entries.has(target) &&
        target !== this.#activeName
      ) {
        this.#ensureSlot(target);
        const oldTool = this._getSlot(this.#activeName)?.tool;
        oldTool?.endAction(context);
        this.#activeName = target;
        context.patchState?.({ routeTarget: this.#activeName });
        this.#lastMirroredName = this.#activeName;
      }
      return;
    }

    if (this.#activeName !== this.#lastMirroredName) {
      context.patchState?.({ routeTarget: this.#activeName });
      this.#lastMirroredName = this.#activeName;
    }

    this._dispatchToSlot(this.#activeName, packet, context);
  }

  /**
   * 结束当前动作
   * @description 传播到当前活跃工具。
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {*} 当前活跃工具 endAction 的返回值
   */
  endAction(context = {}) {
    return this._getSlot(this.#activeName)?.tool?.endAction(context);
  }

  /**
   * 取消当前动作
   * @description 传播到当前活跃工具。
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  cancelAction(context = {}) {
    this._getSlot(this.#activeName)?.tool?.cancelAction(context);
  }

  /**
   * 重置路由目标到默认工具
   * @description 保留已实例化的槽位。
   * @returns {void}
   */
  reset() {
    this.#activeName = this.#defaultName;
    this.#lastMirroredName = null;
  }

  /**
   * 获取调试信息
   * @returns {{ activeName: string, instantiatedSlots: string[] }} 当前路由目标与已实例化槽位
   */
  getDebugInfo() {
    return {
      activeName: this.#activeName,
      instantiatedSlots: this._listSlotIds(),
    };
  }
}

export { ToolSwitcherWrapper };
