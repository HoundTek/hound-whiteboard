/**
 * @file DAG 内部工具函数
 * @description
 * 设备图内部使用的纯工具函数，包括类型判断和处理器返回值规整。
 *
 * 这些函数不持有状态，不依赖 DevicesDAG 实例。
 * `isPlainObject` 是多个模块共用的基础判断，
 * `normalizeHandlerResult` 将 handler 的各种返回形式统一为
 * `{ packets, explicitPackets, ... }` 结构。
 * @module core/ui/devices-dag/dag-utils
 * @author Zhou Chenyu
 */

import { SignalPacket } from "./signal.js";

/**
 * 判断值是否为纯对象
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * 判断一个值是否满足 SubDAGDefinition 的结构约定
 * @description
 * 用于 `mountWorkflow` 中区分 Tool 实例和结构化子图定义。
 * 检查项：`nodes` 为 Map、`edges` 为数组、`rootNodeId` 为数字。
 * @param {any} value - 待判断值
 * @returns {boolean} 满足子图定义结构则返回 true
 */
function isSubDAGDefinition(value) {
  return (
    isPlainObject(value) &&
    value.nodes instanceof Map &&
    Array.isArray(value.edges) &&
    typeof value.rootNodeId === "number"
  );
}

/**
 * 将 handler 的原始返回值规整为标准结果结构。
 *
 * handler 可以返回多种形式：单个 SignalPacket、SignalPacket 数组、
 * 带有路由指令的对象、`undefined` 等。此函数统一转换为
 * `{ packets: SignalPacket[], explicitPackets: boolean, ... }` 结构。
 *
 * @param {*} rawResult - handler 的原始返回值
 * @param {{ defaultTo?: string }} [options={}] - 规整选项
 * @param {string} [options.defaultTo] - 信号包缺省 to 字段值
 * @returns {import("./dag.js").DevicesDAGHandlerResult} 标准结果结构
 */
function normalizeHandlerResult(rawResult, options = {}) {
  if (
    isPlainObject(rawResult) &&
    (Array.isArray(rawResult.packets) ||
      "stop" in rawResult ||
      "redirect" in rawResult ||
      "acc" in rawResult)
  ) {
    return {
      ...rawResult,
      packets: SignalPacket.normalizeResult(rawResult.packets ?? [], options),
      explicitPackets: Object.prototype.hasOwnProperty.call(
        rawResult,
        "packets",
      ),
    };
  }

  if (rawResult === undefined || rawResult === null) {
    return { packets: [], explicitPackets: false };
  }

  if (Array.isArray(rawResult)) {
    const packets = [];
    for (const item of rawResult) {
      if (
        isPlainObject(item) &&
        (Array.isArray(item.packets) ||
          "stop" in item ||
          "redirect" in item ||
          "acc" in item)
      ) {
        packets.push(
          ...SignalPacket.normalizeResult(item.packets ?? [], options),
        );
      } else {
        packets.push(SignalPacket.from(item, options));
      }
    }
    return { packets, explicitPackets: true };
  }

  return {
    packets: SignalPacket.normalizeResult(rawResult, options),
    explicitPackets: true,
  };
}

export { isPlainObject, isSubDAGDefinition, normalizeHandlerResult };
