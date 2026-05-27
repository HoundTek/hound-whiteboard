/**
 * @file 模拟工具对象
 * @description 提供测试中通用的 Tool 模拟类与工厂函数。减少测试文件间的重复定义。
 * @module core/test-support/mock-tools
 * @author Zhou Chenyu
 */

import { Tool } from "../tools/tool.js";

/**
 * 信号收集工具
 * @description 记录每次 process() 调用的信号包和设备上下文，供断言验证。
 * @class
 * @extends Tool
 * @example
 *   const tool = new CollectingTool();
 *   // 挂载后：
 *   expect(tool.calls).toHaveLength(1);
 *   expect(tool.calls[0].signalPacket.signals).toEqual([...]);
 */
class CollectingTool extends Tool {
  calls = [];

  process(signalPacket, deviceContext) {
    this.calls.push({ signalPacket, deviceContext });
  }

  reset() {
    this.calls = [];
  }
}

/**
 * 创建模拟 creator 工具
 * @description
 * 每次 process() 被调用后会自动调用 completeCreatedObject()，
 * 适合验证 wrapCreatorForHandoff 等 hook 行为。
 * @param {Function} [onProcess] - 在 process() 中执行的自定义逻辑
 * @returns {Tool}
 */
function createMockCreator(onProcess) {
  return new (class extends Tool {
    process(packet, ctx) {
      if (onProcess) onProcess(packet, ctx);
      this.completeCreatedObject({});
    }
    completeCreatedObject(_interaction) {}
  })();
}

/**
 * 创建模拟 chooser 工具
 * @description
 * 不含 completeCreatedObject，仅执行自定义回调。
 * @param {Function} [onProcess] - 在 process() 中执行的自定义逻辑
 * @returns {Tool}
 */
function createMockChooser(onProcess) {
  return new (class extends Tool {
    process(packet, ctx) {
      if (onProcess) onProcess(packet, ctx);
    }
  })();
}

/**
 * 创建模拟 modifier 工具
 * @description
 * 不含 completeCreatedObject，仅执行自定义回调。
 * @param {Function} [onProcess] - 在 process() 中执行的自定义逻辑
 * @returns {Tool}
 */
function createMockModifier(onProcess) {
  return new (class extends Tool {
    process(packet, ctx) {
      if (onProcess) onProcess(packet, ctx);
    }
  })();
}

export { CollectingTool, createMockCreator, createMockChooser, createMockModifier };
