/**
 * 信号包抽象
 * @module core/devices/signal
 * @author Zhou Chenyu
 */

/**
 * 信号包
 * @class
 * @description
 * 表示一次在设备树或工具体系中流动的完整输入包。
 */
class SignalPacket {
  /**
   * @param {string} [to=""] - 目标节点路径
   * @param {Array<Object>} [signals=[]] - 信号列表
   */
  constructor(to = "", signals = []) {
    this.to = typeof to === "string" ? to : "";
    this.signals = Array.isArray(signals) ? signals : [];
  }

  /**
   * 将任意输入规整为 SignalPacket。
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
   * 将处理结果规整为 SignalPacket 列表。
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