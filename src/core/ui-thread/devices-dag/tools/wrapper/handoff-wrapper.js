/**
 * @file handoff 包装工具
 * @description 将 first → second 两阶段顺序工作流封装为单个 wrapper tool。
 * @module core/ui-thread/devices-dag/tools/wrapper/handoff-wrapper
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../../dag-core/signal.js";
import { normalizeObjectCollection } from "../tool.js";
import { WrapperTool } from "./wrapper-tool.js";

/**
 * handoff 包装工具
 * @class
 * @extends WrapperTool
 * @description
 * 两阶段顺序组合（first → second → first …）：
 * first（creator / chooser 等）完成并产出对象后切换到 second（通常为 modifier），
 * second 完成后切回 first。
 *
 * 与旧 prefix 子图实现的本质区别：`action:complete` 订阅在构造时建立一次
 * （长期订阅），不再按信号包临时订阅；相位保存在 wrapper 实例字段中，
 * 并通过 `context.patchState` 镜像到 wrapper 自己的节点 state 供外部观察。
 *
 * 构造时会自动适配子工具的提交语义：
 * - first 若有 `autoCommit` 属性则置为 false，阻止对象提前进入静态图
 * - second 若有 `autoUmountOnApply` 属性则置为 false，阻止提交后自卸载
 *
 * @example
 * const handoff = new HandoffWrapperTool({
 *   first: new RectangleObjectChooserTool(),
 *   second: new CommonObjectModifierTool(),
 * });
 */
class HandoffWrapperTool extends WrapperTool {
  /**
   * 第一阶段工具
   * @type {Tool}
   */
  #first;

  /**
   * 第二阶段工具
   * @type {Tool}
   */
  #second;

  /**
   * 是否在 handoff 时自动桥接对象上下文
   * @type {boolean}
   */
  #autoBridgeObjects;

  /**
   * 当前相位
   * @type {"first"|"second"}
   */
  #phase = "first";

  /**
   * 最近一次镜像到节点 state 的相位
   * @type {"first"|"second"|null}
   */
  #lastMirroredPhase = null;

  /**
   * 最近一次 process 的处理器上下文，供完成回调镜像状态使用
   * @type {import("../../dag-type.js").DevicesDAGHandlerContext|null}
   */
  #latestContext = null;

  /**
   * @param {{
   *   first: Tool,
   *   second: Tool,
   *   autoBridgeObjects?: boolean,
   * }} options - handoff 配置
   * @param {Tool} options.first - 第一阶段工具（creator / chooser 等）
   * @param {Tool} options.second - 第二阶段工具（通常为 modifier）
   * @param {boolean} [options.autoBridgeObjects=true] - 是否在 handoff 时自动桥接对象上下文
   * @throws {TypeError} first / second 不是 Tool 实例或两者为同一实例时抛出
   */
  constructor({ first, second, autoBridgeObjects = true } = {}) {
    super();

    if (!first || typeof first.createProcessor !== "function") {
      throw new TypeError("HandoffWrapperTool: first must be a Tool instance.");
    }
    if (!second || typeof second.createProcessor !== "function") {
      throw new TypeError("HandoffWrapperTool: second must be a Tool instance.");
    }
    if (first === second) {
      throw new TypeError(
        "HandoffWrapperTool: first and second cannot be the same tool instance.",
      );
    }

    this.#first = first;
    this.#second = second;
    this.#autoBridgeObjects = autoBridgeObjects !== false;

    // wrapper 嵌入场景：阻止 creator 提前 commit、modifier 提交后自卸载
    if ("autoCommit" in first) {
      first.autoCommit = false;
    }
    if ("autoUmountOnApply" in second) {
      second.autoUmountOnApply = false;
    }

    this._addSlot("first", first);
    this._addSlot("second", second);

    // 长期订阅：与旧实现每包临时订阅的本质区别
    first.on("action:complete", (eventContext, result) =>
      this.#onFirstComplete(eventContext, result),
    );
    second.on("action:complete", (eventContext, result) =>
      this.#onSecondComplete(eventContext, result),
    );
  }

  /**
   * 切换相位并镜像到节点 state
   * @param {"first"|"second"} phase - 目标相位
   * @returns {void}
   */
  #setPhase(phase) {
    this.#phase = phase;
    this.#mirrorPhase();
  }

  /**
   * 将当前相位镜像到 wrapper 自己的节点 state
   * @description 替代原 DAG 子图的结构可观察性，供外部 `getNodeState` 观察。
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context=this.#latestContext] - 镜像使用的上下文
   * @returns {void}
   */
  #mirrorPhase(context = this.#latestContext) {
    context?.patchState?.({
      phase: this.#phase,
      activeChild: this.#phase,
    });
    this.#lastMirroredPhase = this.#phase;
  }

  /**
   * first 完成回调：对象桥接到 second 并切换相位
   * @description 空对象数组不切换相位（对齐旧行为）。
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} eventContext - 完成事件的上下文
   * @param {*} result - 完成事件的结果载荷
   * @returns {void}
   */
  #onFirstComplete(eventContext, result) {
    const objects = normalizeObjectCollection(result).filter(Boolean);
    if (objects.length === 0) {
      return;
    }

    if (this.#autoBridgeObjects) {
      this.#second.receiveHandoffObjects?.(objects, eventContext ?? {});
    }

    this.#setPhase("second");
  }

  /**
   * second 完成回调：切回 first 并刷新 UI overlay
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} eventContext - 完成事件的上下文
   * @param {*} result - 完成事件的结果载荷
   * @returns {void}
   */
  #onSecondComplete(eventContext, result) {
    this.#setPhase("first");
    this._resolveLatestServices()?.viewport?.requestViewportUiRender?.();
  }

  /**
   * 处理一个完整信号包，转发到当前相位对应的子工具
   * @description
   * 相位镜像值与当前相位不同时先同步到节点 state。
   * second 阶段收到 cancel 信号且 dispatch 后相位未被完成回调改变时，
   * 丢弃 second 持有的活动对象、切回 first 并刷新 UI overlay（对齐旧 `completeOnCancel` 行为）。
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  process(signalPacket, context = {}) {
    const packet = SignalPacket.from(signalPacket);
    this.#latestContext = context;

    if (this.#phase !== this.#lastMirroredPhase) {
      this.#mirrorPhase(context);
    }

    const phaseBeforeDispatch = this.#phase;
    const hasCancelSignal = packet.signals.some(
      (signal) => signal?.type === "cancel",
    );

    this._dispatchToSlot(phaseBeforeDispatch, packet, context);

    if (
      phaseBeforeDispatch === "second" &&
      hasCancelSignal &&
      this.#phase === "second"
    ) {
      // 对齐旧 completeOnCancel 的丢弃语义：second 的 cancel 手势只回滚几何，
      // 其持有的活动对象需由 wrapper 显式丢弃
      this.#second.discardAction?.(this._buildSlotContext("second", context));
      this.#setPhase("first");
      this._resolveLatestServices()?.viewport?.requestViewportUiRender?.();
    }
  }

  /**
   * 结束当前动作
   * @description 对当前相位工具调用 `endAction`。
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {*} 当前相位工具 endAction 的返回值
   */
  endAction(context = {}) {
    return this._getSlot(this.#phase)?.tool?.endAction(context);
  }

  /**
   * 取消当前动作
   * @description 对当前相位工具调用 `cancelAction` 并切回 first。
   * @param {import("../../dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  cancelAction(context = {}) {
    this._getSlot(this.#phase)?.tool?.cancelAction(context);
    this.#setPhase("first");
  }

  /**
   * 重置相位到 first
   * @description 不销毁槽位，已建立的订阅与桥接关系保留。
   * @returns {void}
   */
  reset() {
    this.#phase = "first";
    this.#lastMirroredPhase = null;
  }

  /**
   * 获取调试信息
   * @returns {{ phase: "first"|"second" }} 当前相位
   */
  getDebugInfo() {
    return { phase: this.#phase };
  }
}

export { HandoffWrapperTool };
