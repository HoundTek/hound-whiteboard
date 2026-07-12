/**
 * @file 信号包抽象
 * @description 定义设备图和工具系统中流动的信号包结构。
 * @module core/ui/devices-dag/signal
 * @author Zhou Chenyu
 */

/**
 * 信号包
 * @class
 * @description 表示一次在设备图或工具体系中流动的完整输入包。
 * @author Zhou Chenyu
 */
class SignalPacket {
  /**
   * 目标节点路径
   * @type {string}
   */
  to;

  /**
   * 信号列表
   * @type {Array<{type: string, context?: {value?: *, [key: string]: *}}>}
   */
  signals;

  /**
   * @param {string} [to=""] - 目标节点路径
   * @param {Array<Object>} [signals=[]] - 信号列表
   */
  constructor(to = "", signals = []) {
    this.to = typeof to === "string" ? to : "";
    this.signals = Array.isArray(signals) ? signals : [];
  }

  /**
   * 将任意输入规整为 SignalPacket
   * @param {Object|SignalPacket|null|undefined} signalPacket - 原始输入
   * @param {{defaultTo?: string}} [options={}] - 规整选项
   * @returns {SignalPacket}
   */
  static from(signalPacket = {}, options = {}) {
    const defaultTo = options.defaultTo ?? "";
    if (signalPacket instanceof SignalPacket) {
      if (signalPacket.to === undefined || signalPacket.to === null) {
        return new SignalPacket(defaultTo, signalPacket.signals);
      }
      return signalPacket;
    }

    return new SignalPacket(
      signalPacket?.to ?? defaultTo,
      Array.isArray(signalPacket?.signals) ? signalPacket.signals : [],
    );
  }

  /**
   * 将处理结果规整为 SignalPacket 列表
   * @param {SignalPacket|Object|Array<SignalPacket|Object>|null|undefined} result - 原始处理结果
   * @param {{defaultTo?: string}} [options={}] - 规整选项
   * @returns {SignalPacket[]}
   */
  static normalizeResult(result, options = {}) {
    if (result === undefined || result === null) return [];
    const packets = Array.isArray(result) ? result : [result];
    return packets.map((packet) => SignalPacket.from(packet, options));
  }
}

export { SignalPacket };
