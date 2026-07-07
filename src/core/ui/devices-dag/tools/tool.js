/**
 * @file 工具基类
 * @description 定义所有白板交互工具的公共接口与行为。
 * @module core/ui/devices-dag/tools/tool
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../signal.js";

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
   * @returns {import("../devices-dag/dag.js").DevicesDAGHandler}
   */
  createProcessor() {
    const uiOverlayBinding = this.createUiOverlayBinding();
    const processor = (signalPacket, handlerContext = {}) => {
      uiOverlayBinding?.sync(handlerContext);
      return this.process(SignalPacket.from(signalPacket), handlerContext);
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
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}]
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
        const viewport = context.acc?.viewport;
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
        const viewport = registeredViewport ?? context.acc?.viewport;
        if (viewport?.unregisterUiOverlayProvider) {
          viewport.unregisterUiOverlayProvider(provider, {
            invalidate: false,
          });
        }

        registeredViewport = null;
        context.acc?.viewport?.requestViewportUiRender?.();
      },
    };

    this._cachedUiOverlayBinding = binding;
    return binding;
  }

  /**
   * 读取当前路径关联的节点状态
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
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
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
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
   * 从设备上下文中解析当前对象集合
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {Array<*>}
   */
  resolveContextObjects(context = {}) {
    const nodeState = this.resolveNodeState(context);
    if (nodeState.objects) {
      return this.normalizeObjectCollection(nodeState.objects);
    }
    if (context.acc?.objects) {
      return this.normalizeObjectCollection(context.acc.objects);
    }
    return [];
  }

  /**
   * 解析对象条目的数字 id
   * @param {*} objectEntry - 对象实例或兼容条目
   * @returns {number|null} objectId
   */
  resolveObjectId(objectEntry) {
    return typeof objectEntry?.id === "number" ? objectEntry.id : null;
  }

  /**
   * 批量解析对象条目的数字 id
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @param {Iterable<*>|*} objects - 对象或对象集合
   * @returns {number[]} 去重后的 objectId 列表
   */
  resolveObjectIds(context, objects) {
    return [
      ...new Set(
        this.normalizeObjectCollection(objects)
          .map((objectEntry) => this.resolveObjectId(objectEntry))
          .filter((objectId) => objectId != null),
      ),
    ];
  }

  /**
   * 将对象集合写回设备上下文与节点上下文
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
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

    context.acc.objects = normalizedObjects;

    const nodeState = this.resolveNodeState(context);
    this.writeNodeState(context, {
      ...nodeState,
      objects: normalizedObjects,
    });

    return normalizedObjects;
  }

  /**
   * 清理设备上下文中的对象引用
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  clearContextObjects(context = {}) {
    delete context.acc?.objects;

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
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  requestUiOverlayRefresh(context = {}) {
    context.acc?.viewport?.requestViewportUiRender?.();
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
   * 处理一个完整信号包
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} context - 设备图处理器上下文
   * @returns {void}
   * @abstract
   */
  process(signalPacket, context) {
    throw new Error("Method not implemented.");
  }

  /**
   * 工具节点被卸载时执行清理
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}] - 设备图处理器上下文
   * @returns {void}
   */
  umount(context = {}) {
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

export { Tool };
