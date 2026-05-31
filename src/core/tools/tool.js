/**
 * @file 工具基类
 * @description 定义所有白板交互工具的公共接口与行为。
 * @module core/tools/tool
 * @author Zhou Chenyu
 */

import { SignalPacket } from "../devices/signal.js";

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
   * @constructor
   */
  constructor() {}

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
   * @return {Object} 序列化后的工具数据
   * @abstract
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 将设备图上下文规整为工具上下文。
   * 当前稳定模型只产出平面 deviceContext；累积上下文保留在 context 字段中。
   * @param {{
   *   path?: string, dag?: Object, node?: Object, defaultChild?: string,
   *   resolvedDefaultChildPath?: string, depth?: number,
   *   context?: Object, getNodeState?: Function, setNodeState?: Function
   * }} [handlerContext={}] - 设备图处理上下文
   * @param {Object} [toolContext={}] - 工具固定上下文
   * @returns {Object}
   */
  createDeviceContext(handlerContext = {}, toolContext = {}) {
    const accumulatedContext = handlerContext.context ?? {};
    const board = accumulatedContext.board ?? toolContext.board;
    const monitor = accumulatedContext.monitor ?? toolContext.monitor;
    const allocateObjectId =
      accumulatedContext.allocateObjectId ??
      toolContext.allocateObjectId ??
      board?.allocateObjectId?.bind(board);
    const resolveOwnerChunkId =
      accumulatedContext.resolveOwnerChunkId ??
      toolContext.resolveOwnerChunkId ??
      (typeof monitor?.worldToChunk === "function"
        ? (position) => {
            if (
              !position ||
              typeof position.x !== "number" ||
              typeof position.y !== "number"
            ) {
              return undefined;
            }
            return monitor.worldToChunk(position)?.chunkId;
          }
        : undefined);

    return {
      dag: handlerContext.dag,
      node: handlerContext.node,
      semantics: handlerContext.semantics ?? {},
      path: handlerContext.path ?? handlerContext.node?.path ?? "",
      defaultChild: handlerContext.defaultChild ?? "",
      resolvedDefaultChildPath:
        handlerContext.resolvedDefaultChildPath ?? handlerContext.path ?? "",
      depth: handlerContext.depth ?? 0,
      board,
      monitor,
      allocateObjectId,
      resolveOwnerChunkId,
      context: accumulatedContext,
      getNodeState:
        typeof handlerContext.getNodeState === "function"
          ? handlerContext.getNodeState
          : undefined,
      setNodeState:
        typeof handlerContext.setNodeState === "function"
          ? handlerContext.setNodeState
          : undefined,
    };
  }

  /**
   * 创建一个可直接挂载到设备图节点上的处理器。
   * @param {Object} [toolContext = {}] - 工具固定上下文
   * @returns {import("../devices/devices-dag.js").DevicesDAGHandler}
   */
  createProcessor(toolContext = {}) {
    const uiOverlayBinding = this.createUiOverlayBinding(toolContext);
    const processor = (signalPacket, handlerContext = {}) => {
      const deviceContext = this.createDeviceContext(
        handlerContext,
        toolContext,
      );
      uiOverlayBinding?.sync(deviceContext);
      return this.process(SignalPacket.from(signalPacket), deviceContext);
    };

    processor.dispose = (handlerContext = {}) => {
      const deviceContext = this.createDeviceContext(
        handlerContext,
        toolContext,
      );
      uiOverlayBinding?.cleanup(deviceContext);
    };

    return processor;
  }

  /**
   * 为当前工具处理器创建 ui overlay 绑定。
   * @param {Object} [toolContext={}] - 工具固定上下文
   * @returns {{ sync: Function, cleanup: Function } | null}
   */
  createUiOverlayBinding(toolContext = {}) {
    if (
      this.collectUiOverlayEntries === Tool.prototype.collectUiOverlayEntries
    ) {
      return null;
    }

    let latestDeviceContext = {};
    let registeredMonitor = null;
    const provider = (overlayContext = {}) =>
      this.collectUiOverlayEntries({
        ...overlayContext,
        toolContext,
        deviceContext: latestDeviceContext,
      });

    return {
      sync: (deviceContext = {}) => {
        latestDeviceContext = deviceContext;

        const monitor = deviceContext.monitor;
        if (!monitor?.registerUiOverlayProvider) {
          return;
        }

        if (registeredMonitor === monitor) {
          return;
        }

        if (registeredMonitor?.unregisterUiOverlayProvider) {
          registeredMonitor.unregisterUiOverlayProvider(provider, {
            invalidate: false,
          });
        }

        registeredMonitor = monitor;
        monitor.registerUiOverlayProvider(provider, {
          invalidate: false,
        });
      },
      cleanup: (deviceContext = {}) => {
        latestDeviceContext = deviceContext;

        const monitor = registeredMonitor ?? deviceContext.monitor;
        if (monitor?.unregisterUiOverlayProvider) {
          monitor.unregisterUiOverlayProvider(provider, {
            invalidate: false,
          });
        }

        registeredMonitor = null;
        latestDeviceContext = {};
        deviceContext.monitor?.requestViewportUiRender?.();
      },
    };
  }

  /**
   * 读取当前路径关联的节点状态。
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {string} [statePath=deviceContext.path] - 节点路径
   * @returns {Object}
   */
  resolveNodeState(deviceContext = {}, statePath = deviceContext.path) {
    if (typeof deviceContext.getNodeState !== "function") {
      return {};
    }

    return deviceContext.getNodeState(statePath) ?? {};
  }

  /**
   * 写入当前路径关联的节点状态。
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {Object} nextState - 新状态
   * @param {string} [statePath=deviceContext.path] - 节点路径
   * @returns {Object}
   */
  writeNodeState(
    deviceContext = {},
    nextState,
    statePath = deviceContext.path,
  ) {
    if (typeof deviceContext.setNodeState !== "function") {
      return nextState ?? {};
    }

    return deviceContext.setNodeState(statePath, nextState ?? {}) ?? {};
  }

  /**
   * 将单对象或对象集合规整为数组。
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
   * 从设备上下文中解析当前对象集合。
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {Array<*>}
   */
  resolveContextObjects(deviceContext = {}) {
    if (deviceContext.objects) {
      return this.normalizeObjectCollection(deviceContext.objects);
    }
    if (deviceContext.object) {
      return [deviceContext.object];
    }
    const nodeState = this.resolveNodeState(deviceContext);
    if (nodeState.objects) {
      return this.normalizeObjectCollection(nodeState.objects);
    }
    if (nodeState.object) {
      return [nodeState.object];
    }
    return [];
  }

  /**
   * 将对象集合写回设备上下文与节点上下文。
   * @param {Object} [deviceContext={}] - 设备上下文
   * @param {Iterable<*>|*} objects - 对象或对象集合
   * @returns {Array<*>}
   */
  setContextObjects(deviceContext = {}, objects) {
    const normalizedObjects =
      this.normalizeObjectCollection(objects).filter(Boolean);

    if (normalizedObjects.length === 0) {
      this.clearContextObjects(deviceContext);
      return [];
    }

    deviceContext.objects = normalizedObjects;
    deviceContext.object = normalizedObjects[0];

    const nodeState = this.resolveNodeState(deviceContext);
    this.writeNodeState(deviceContext, {
      ...nodeState,
      objects: normalizedObjects,
      object: normalizedObjects[0],
    });

    return normalizedObjects;
  }

  /**
   * 清理设备上下文中的对象引用。
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {void}
   */
  clearContextObjects(deviceContext = {}) {
    delete deviceContext.object;
    delete deviceContext.objects;

    const nodeState = { ...this.resolveNodeState(deviceContext) };
    if (Object.prototype.hasOwnProperty.call(nodeState, "object")) {
      delete nodeState.object;
    }
    if (Object.prototype.hasOwnProperty.call(nodeState, "objects")) {
      delete nodeState.objects;
    }

    this.writeNodeState(deviceContext, nodeState);
  }

  /**
   * 收集当前工具声明的 ui overlay 条目。
   * @param {{ deviceContext?: Object, monitor?: Object, activeObjectManager?: Object, renderer?: Object, toolContext?: Object }} [_overlayContext={}] - overlay 上下文
   * @returns {Array<*>}
   */
  collectUiOverlayEntries(_overlayContext = {}) {
    return [];
  }

  /**
   * 主动请求 ui overlay 重绘。
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {void}
   */
  requestUiOverlayRefresh(deviceContext = {}) {
    deviceContext.monitor?.requestViewportUiRender?.();
  }

  /**
   * 处理一个完整信号包
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   * @abstract
   */
  process(signalPacket, deviceContext) {
    throw new Error("Method not implemented.");
  }

  /**
   * 工具节点被卸载时执行清理。
   * @param {Object} [deviceContext={}] - 卸载时的设备上下文
   * @returns {void}
   */
  umount(deviceContext = {}) {
    if (this.reset !== Tool.prototype.reset) {
      this.reset(deviceContext);
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
