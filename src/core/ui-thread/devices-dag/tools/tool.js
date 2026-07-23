/**
 * @file 工具基类
 * @description 定义所有白板交互工具的公共接口与行为。
 * @module core/ui-thread/devices-dag/tools/tool
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../dag-core/signal.js";

/**
 * 将单对象或对象集合规整为数组（纯函数）
 * @param {Iterable<*>|*} objects - 原始对象或对象集合
 * @returns {Array<*>}
 */
function normalizeObjectCollection(objects) {
  if (objects == null) return [];

  if (
    typeof objects !== "string" &&
    typeof objects[Symbol.iterator] === "function"
  ) {
    return Array.from(objects);
  }

  return [objects];
}

/**
 * 解析对象条目的数字 id（纯函数）
 * @param {*} objectEntry - 对象实例或兼容条目
 * @returns {number|null}
 */
function resolveObjectId(objectEntry) {
  return typeof objectEntry?.id === "number" ? objectEntry.id : null;
}

/**
 * 批量解析对象条目的数字 id，去重（纯函数）
 * @param {Iterable<*>|*} objects - 对象或对象集合
 * @returns {number[]}
 */
function resolveObjectIds(objects) {
  return [
    ...new Set(
      normalizeObjectCollection(objects)
        .map((entry) => resolveObjectId(entry))
        .filter((id) => id != null),
    ),
  ];
}

/**
 * 工具基类
 *
 * @class
 * @abstract
 * @description
 * 工具是挂载在设备图末端的消费型处理器，不再负责把信号继续向下转发。
 * 它接收设备图节点送来的完整信号包，并直接修改白板或相关状态。
 *
 * 工具类定义了所有工具的基本属性和方法，具体工具应继承此类并实现其特定功能。
 * @author Zhou Chenyu
 */
class Tool {
  /**
   * 生命周期钩子监听器集合，钩子名称->监听器函数数组
   * @type {Map<string, Array<Function>>|null}
   * @private
   */
  _hooks;

  /**
   * 初始化工具实例
   * @constructor
   */
  constructor() {
    this._hooks = null;

    /**
     * 当前动作是否活跃
     * @type {boolean}
     */
    this.isActionActive = false;
  }

  /**
   * 解析序列化的工具数据以创建工具实例
   * @returns {Tool} 创建的工具实例
   * @static
   * @abstract
   */
  static parse() {
    throw new Error("Method not implemented.");
  }

  /**
   * 序列化工具实例以保存工具数据
   * @returns {Object} 序列化后的工具数据
   * @abstract
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 创建一个可直接挂载到设备图节点上的处理器
   * @description
   * DAG handler 必须是同步的：工具的异步动作结果（如 chooser 的
   * hitTest 提交）经事件通道（`action:complete` / `afterChoose`）传递，
   * 不允许穿透为 handler 返回值——DAG 层会忽略并告警。
   * @returns {import("../devices-dag/dag-type.js").DevicesDAGHandler}
   */
  createProcessor() {
    const uiOverlayBinding = this.createUiOverlayBinding();
    const processor = (signalPacket, handlerContext = {}) => {
      uiOverlayBinding?.sync(handlerContext);
      const result = this.process(
        SignalPacket.from(signalPacket),
        handlerContext,
      );
      return result instanceof Promise ? undefined : result;
    };

    processor.dispose = (handlerContext = {}) => {
      uiOverlayBinding?.cleanup(handlerContext);
    };

    return processor;
  }

  /**
   * 在不处理信号的情况下将当前工具的 overlay provider 注册到 viewport。
   * 供 handoff 等场景在第一个信号到达前调用。
   * createUiOverlayBinding 内建缓存，重复调用不会重复注册。
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}]
   * @returns {void}
   */
  syncUiOverlay(context = {}) {
    const binding = this.createUiOverlayBinding();
    binding?.sync(context);
  }

  /**
   * 为当前工具处理器创建 ui overlay 绑定
   * @returns {{ sync: Function, cleanup: Function } | null}
   */
  createUiOverlayBinding() {
    if (this._cachedUiOverlayBinding !== undefined) {
      return this._cachedUiOverlayBinding;
    }

    if (
      this.collectUiOverlayEntries === Tool.prototype.collectUiOverlayEntries
    ) {
      this._cachedUiOverlayBinding = null;
      return null;
    }

    let registeredViewport = null;
    const provider = (overlayContext = {}) =>
      this.collectUiOverlayEntries({
        viewport: overlayContext.viewport,
        renderer: overlayContext.renderer,
      });

    const binding = {
      sync: (context = {}) => {
        const viewport = context.services?.viewport;
        if (!viewport?.registerUiOverlayProvider) {
          return;
        }

        if (registeredViewport === viewport) {
          return;
        }

        if (registeredViewport?.unregisterUiOverlayProvider) {
          registeredViewport.unregisterUiOverlayProvider(provider, {
            invalidate: false,
          });
        }

        registeredViewport = viewport;
        viewport.registerUiOverlayProvider(provider, {
          invalidate: false,
        });
      },
      cleanup: (context = {}) => {
        const viewport = registeredViewport ?? context.services?.viewport;
        if (viewport?.unregisterUiOverlayProvider) {
          viewport.unregisterUiOverlayProvider(provider, {
            invalidate: false,
          });
        }

        registeredViewport = null;
        context.services?.viewport?.requestViewportUiRender?.();
      },
    };

    this._cachedUiOverlayBinding = binding;
    return binding;
  }

  /**
   * 读取当前路径关联的节点状态
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {string} [statePath=context.path] - 节点路径
   * @returns {Object}
   */
  resolveNodeState(context = {}, statePath = context.path) {
    if (typeof context.getNodeState !== "function") {
      return {};
    }

    return context.getNodeState(statePath) ?? {};
  }

  /**
   * 写入当前路径关联的节点状态
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {Object} nextState - 新状态
   * @param {string} [statePath=context.path] - 节点路径
   * @returns {Object}
   */
  writeNodeState(context = {}, nextState, statePath = context.path) {
    if (typeof context.setNodeState !== "function") {
      return nextState ?? {};
    }

    return context.setNodeState(statePath, nextState ?? {}) ?? {};
  }

  /**
   * 将单对象或对象集合规整为数组
   * @param {Iterable<*>|*} objects - 原始对象或对象集合
   * @returns {Array<*>}
   */
  normalizeObjectCollection(objects) {
    return normalizeObjectCollection(objects);
  }

  /**
   * 读取当前节点状态的 objects 投影
   * @description
   * 公开只读 API，供观察方与测试读取工具发布的 objects 投影。
   * 禁止在工具内部逻辑中把它当作对象集合的真相源——真相源是各工具的实例字段。
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {Array<*>}
   */
  resolveContextObjects(context = {}) {
    const nodeState = this.resolveNodeState(context);
    if (nodeState.objects) {
      return this.normalizeObjectCollection(nodeState.objects);
    }
    return [];
  }

  /**
   * 解析对象条目的数字 id
   * @param {*} objectEntry - 对象实例或兼容条目
   * @returns {number|null} objectId
   */
  resolveObjectId(objectEntry) {
    return resolveObjectId(objectEntry);
  }

  /**
   * 批量解析对象条目的数字 id
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Iterable<*>|*} objects - 对象或对象集合
   * @returns {number[]} 去重后的 objectId 列表
   */
  resolveObjectIds(context, objects) {
    return resolveObjectIds(objects);
  }

  /**
   * 将对象集合发布为当前节点状态的 objects 投影
   * @description
   * 投影仅供跨 handler 观察；对象集合的真相源是各工具的实例字段，
   * 工具逻辑禁止从投影读回。传入空集合时转为清除投影。
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @param {Iterable<*>|*} objects - 对象或对象集合
   * @returns {Array<*>}
   */
  setContextObjects(context = {}, objects) {
    const normalizedObjects =
      this.normalizeObjectCollection(objects).filter(Boolean);

    if (normalizedObjects.length === 0) {
      this.clearContextObjects(context);
      return [];
    }

    const nodeState = this.resolveNodeState(context);
    this.writeNodeState(context, {
      ...nodeState,
      objects: normalizedObjects,
    });

    return normalizedObjects;
  }

  /**
   * 清除当前节点状态的 objects 投影
   * @description
   * 从节点 `state` 中移除 `objects` 投影键；调用方需同步清理自己的实例字段真相源。
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  clearContextObjects(context = {}) {
    const nodeState = { ...this.resolveNodeState(context) };
    if (Object.prototype.hasOwnProperty.call(nodeState, "objects")) {
      delete nodeState.objects;
    }

    this.writeNodeState(context, nodeState);
  }

  /**
   * 收集当前工具声明的 ui overlay 条目
   * @param {{
   *   viewport?: import("../components/orchestration/viewport.js").Viewport,
   *   renderer?: import("../components/renderer/ui-renderer.js").UiRenderer,
   * }} [_overlayContext={}] - overlay 上下文
   * @returns {import("../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectUiOverlayEntries(_overlayContext = {}) {
    return [];
  }

  /**
   * 主动请求 ui overlay 重绘
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  requestUiOverlayRefresh(context = {}) {
    context.services?.viewport?.requestViewportUiRender?.();
  }

  /**
   * 注册生命周期钩子监听器
   * @param {string} hookName - 钩子名称
   * @param {Function} listener - 监听器函数
   * @returns {Function} 取消订阅函数
   */
  on(hookName, listener) {
    if (!this._hooks) this._hooks = new Map();
    if (!this._hooks.has(hookName)) this._hooks.set(hookName, []);
    this._hooks.get(hookName).push(listener);
    return () => this.off(hookName, listener);
  }

  /**
   * 取消生命周期钩子监听
   * @param {string} hookName - 钩子名称
   * @param {Function} listener - 监听器函数
   */
  off(hookName, listener) {
    const list = this._hooks?.get(hookName);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  }

  /**
   * 触发钩子（仅用于通知型钩子，不涉及控制流）
   * @param {string} hookName - 钩子名称
   * @param {...any} args - 传递给监听器的参数
   * @protected
   */
  _emit(hookName, ...args) {
    const list = this._hooks?.get(hookName);
    if (!list) return;
    for (const fn of list) fn(...args);
  }

  /**
   * 折叠钩子——将监听器返回值逐层折叠为最终结果（适用于控制流钩子）
   * @template T
   * @param {string} hookName - 钩子名称
   * @param {T} initialValue - 初始值
   * @param {...any} args - 传递给每个监听器的额外参数
   * @returns {T} 折叠后的最终值
   * @protected
   */
  _foldHooks(hookName, initialValue, ...args) {
    const list = this._hooks?.get(hookName);
    if (!list || list.length === 0) return initialValue;
    return list.reduce((acc, fn) => fn(acc, ...args), initialValue);
  }

  /**
   * 动作开始
   * @description
   * 标记当前工具进入活跃动作状态。手势工具在首个 position 信号触发
   * 此方法，多指 wrapper 在首个触点到达时触发。工具切换前可调此方法确保状态机同步。
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}]
   * @returns {void}
   */
  beginAction(context = {}) {
    this.isActionActive = true;
    this._emit("action:begin", context);
  }

  /**
   * 动作完成（提交结果）
   * @description
   * 子类 override 实现具体的提交逻辑。默认仅将 isActionActive 置 false。
   * 外部模块（如 tool-switcher）可通过此方法统一结束当前工具动作，
   * 无需理解具体工具的信号语义。
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}]
   * @returns {*}
   */
  completeAction(context = {}) {
    this.isActionActive = false;
  }

  /**
   * 动作取消（丢弃结果）
   * @description
   * 子类 override 实现具体的丢弃逻辑。默认调用 reset() 清理状态，
   * 并触发 action:cancel 钩子。
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}]
   * @returns {void}
   */
  cancelAction(context = {}) {
    this.isActionActive = false;
    this.reset();
    this._emit("action:cancel", context);
  }

  /**
   * 结束当前动作（外部调用入口）
   * @description
   * 供 tool-switcher 等外部模块调用，在切换工具前让当前工具完成手头工作并结束。
   * 默认调用 completeAction。手势工具会先完成手势再提交动作。
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}]
   * @returns {*}
   */
  endAction(context = {}) {
    if (this.isActionActive) {
      return this.completeAction(context);
    }
  }

  /**
   * 处理一个完整信号包
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   * @abstract
   */
  process(signalPacket, context) {
    throw new Error("Method not implemented.");
  }

  /**
   * 工具节点被卸载时执行清理
   * @param {import("../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
    if (this.isActionActive) {
      this.cancelAction(context);
    }
    if (this.reset !== Tool.prototype.reset) {
      this.reset(context);
    }
  }

  /**
   * 重置工具状态
   * @abstract
   */
  reset() {
    throw new Error("Method not implemented.");
  }
}

export { normalizeObjectCollection, resolveObjectId, resolveObjectIds, Tool };
