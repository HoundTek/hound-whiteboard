/**
 * 工具基类
 * @module core/tools/tool
 * @author Zhou Chenyu
 */

/**
 * 工具基类
 *
 * @class
 * @abstract
 * @description
 * 工具是设备与白板交互的媒介，不同的工具有不同的交互方式。
 * 例如，画笔工具允许用户绘制图形，而选择工具允许用户选择和操作已有对象。
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
    * 将输入信号包规整为统一结构。
   * @param {{to?: string, signals?: Array<Object>}} signalPacket - 输入信号包
   * @returns {{to: string, signals: Array<Object>}} 规整后的信号包
   */
  static normalizeSignalPacket(signalPacket = {}) {
    return {
      to: signalPacket.to ?? "",
      signals: Array.isArray(signalPacket.signals) ? signalPacket.signals : [],
    };
  }

  /**
   * 构造单个信号。
   * @param {string} type - 信号类型
   * @param {Object} [context={}] - 信号上下文
   * @returns {{type: string, context: Object}} 信号对象
   */
  static createSignal(type, context = {}) {
    return { type, context };
  }

  /**
   * 规整工具处理后的结果。
   * @param {{to?: string, signals?: Array<Object>}|Array<{to?: string, signals?: Array<Object>}>} result - 工具处理结果
   * @returns {Array<{to: string, signals: Array<Object>}>} 规整后的信号包列表
   */
  static normalizeProcessResult(result) {
    if (result === undefined || result === null) return [];
    const packets = Array.isArray(result) ? result : [result];
    return packets.map((packet) => Tool.normalizeSignalPacket(packet));
  }

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
   * 处理一个完整信号包。
   * @param {{to?: string, signals?: Array<Object>}} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {Array<{to: string, signals: Array<Object>}>|{to: string, signals: Array<Object>}|null} 输出信号包
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

export {
  Tool,
};
