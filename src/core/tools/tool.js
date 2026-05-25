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
 * 工具是挂载在设备树末端的消费型处理器，不再负责把信号继续向下转发。
 * 它接收设备树节点送来的完整信号包，并直接修改白板或相关状态。
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
   * @throws {Error} 基类未实现此方法
   * @static
   * @abstract
   */
  static parse() {
    throw new Error("Method not implemented.");
  }

  /**
   * 序列化工具实例以保存工具数据
   * @return {Object} 序列化后的工具数据
   * @throws {Error} 基类未实现此方法
   * @abstract
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 创建一个可直接挂载到设备树节点上的处理器
   * @param {Object} [toolContext = {}] - 工具固定上下文
   * @returns {import("../devices/devices-tree.js").DevicesTreeProcessor}
   */
  createProcessor(toolContext = {}) {
    return (signalPacket, routeContext = {}) => {
      const board = routeContext.board ?? toolContext.board;
      const monitor = routeContext.monitor ?? toolContext.monitor;
      const resolveOwnerChunkId =
        routeContext.resolveOwnerChunkId ??
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
      const deviceContext = Object.assign(
        routeContext,
        toolContext,
        routeContext,
      );
      deviceContext.allocateObjectId =
        routeContext.allocateObjectId ??
        toolContext.allocateObjectId ??
        board?.allocateObjectId?.bind(board);
      deviceContext.resolveOwnerChunkId = resolveOwnerChunkId;
      return this.process(SignalPacket.from(signalPacket), deviceContext);
    };
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
    if (deviceContext.nodeContext?.objects) {
      return this.normalizeObjectCollection(deviceContext.nodeContext.objects);
    }
    if (deviceContext.nodeContext?.object) {
      return [deviceContext.nodeContext.object];
    }
    if (deviceContext.providedObjectsContext?.objects) {
      return this.normalizeObjectCollection(
        deviceContext.providedObjectsContext.objects,
      );
    }
    if (deviceContext.providedObjectsContext?.object) {
      return [deviceContext.providedObjectsContext.object];
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
    const normalizedObjects = this.normalizeObjectCollection(objects).filter(
      Boolean,
    );

    if (normalizedObjects.length === 0) {
      this.clearContextObjects(deviceContext);
      return [];
    }

    deviceContext.objects = normalizedObjects;
    deviceContext.object = normalizedObjects[0];

    for (const context of [
      deviceContext.nodeContext,
      deviceContext.providedObjectsContext,
    ]) {
      if (!context) continue;
      context.objects = normalizedObjects;
      context.object = normalizedObjects[0];
    }

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

    for (const context of [
      deviceContext.nodeContext,
      deviceContext.providedObjectsContext,
    ]) {
      if (!context) continue;
      delete context.object;
      delete context.objects;
    }
  }

  /**
   * 若当前节点存在默认子节点，则继续向默认路径转发原始信号包。
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {Object|undefined}
   */
  continueToDefaultPath(signalPacket, deviceContext = {}) {
    if (!deviceContext.defaultPath || !deviceContext.resolvedDefaultPath) {
      return undefined;
    }

    if (!deviceContext.tree?.getNode?.(deviceContext.resolvedDefaultPath)) {
      return undefined;
    }

    const packet = SignalPacket.from(signalPacket);
    return {
      to: deviceContext.defaultPath,
      signals: packet.signals,
    };
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
   * @throws {Error} 基类未实现此方法
   * @abstract
   */
  reset() {
    throw new Error("Method not implemented.");
  }
}

export { Tool };
