/**
 * @file repeator 修饰节点处理器
 * @description
 * 提供 createRepeatorPrefixHandler，基于 createPrefixNodeHandler 实现，
 * 将输入的信号包复制为多份并发往相同或不同子节点。适合广播、双重副作用等场景。
 * @module core/prefixs/repeator-handler
 * @author Zhou Chenyu
 */

import { shallowCloneSignals } from "./utils.js";
import { createPrefixNodeHandler } from "./handler.js";

/**
 * 创建 repeator 修饰节点处理器，将每条信号包复制为多份发出
 * @description
 * 工厂函数，基于 createPrefixNodeHandler 构建信号复制分发逻辑。
 * 将输入信号包浅克隆后，向 toChildren 指定的每个子节点各发一份。
 * 省略 toChildren 时回退到当前 prefix 节点的 defaultChild。
 * @param {{
 *   toChildren?: string|string[],
 *   cloneSignals?: Function,
 * }} options - repeator 选项
 * @param {string|string[]} [options.toChildren] - 目标子节点名。传字符串时单发；传数组时每项各发一份。省略时回退到当前 prefix 节点的 defaultChild
 * @param {Function} [options.cloneSignals] - 自定义信号克隆函数。省略时使用浅层展开克隆
 * @returns {import("../devices-dag/dag.js").DevicesDAGHandler} 可挂载到 DevicesDAG 节点上的处理器函数
 */
function createRepeatorPrefixHandler(options = {}) {
  const cloneFn =
    typeof options.cloneSignals === "function"
      ? options.cloneSignals
      : shallowCloneSignals;

  /**
   * 解析目标子节点列表
   * @param {import("../devices-dag/dag.js").DevicesDAGHandlerContext} prefixContext - 当前修饰节点上下文
   * @returns {Array<string>}
   */
  const resolveTargets = (prefixContext) => {
    const specified = options.toChildren;
    if (typeof specified === "string" && specified) {
      return [specified];
    }
    if (Array.isArray(specified) && specified.length) {
      return specified.filter((child) => typeof child === "string" && child);
    }
    const defaultChild = prefixContext.defaultChild;
    return typeof defaultChild === "string" && defaultChild
      ? [defaultChild]
      : [];
  };

  return createPrefixNodeHandler({
    handle(packet, prefixContext) {
      const targets = resolveTargets(prefixContext);
      if (!targets.length) {
        return prefixContext.stop();
      }

      return {
        packets: targets.flatMap((childName) => {
          const result = prefixContext.routeToChild(
            childName,
            cloneFn(packet.signals),
          );
          return Array.isArray(result?.packets) ? result.packets : [];
        }),
      };
    },
  });
}

export { createRepeatorPrefixHandler };
