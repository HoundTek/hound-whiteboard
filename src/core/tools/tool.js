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
      this.process(SignalPacket.from(signalPacket), {
        ...toolContext,
        ...routeContext,
        allocateObjectId:
          routeContext.allocateObjectId ??
          toolContext.allocateObjectId ??
          board?.allocateObjectId?.bind(board),
        resolveOwnerChunkId,
      });
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
   * 重置工具状态
   * @throws {Error} 基类未实现此方法
   * @abstract
   */
  reset() {
    throw new Error("Method not implemented.");
  }
}

export { Tool };
