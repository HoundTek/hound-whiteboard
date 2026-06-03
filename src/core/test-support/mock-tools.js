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
 * const tool = new CollectingTool();
 * // 挂载后：
 * expect(tool.calls).toHaveLength(1);
 * expect(tool.calls[0].signalPacket.signals).toEqual([...]);
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
 * 实现完整的创建生命周期钩子，默认过程：
 *   finalize → beforeCommit → commit（可选）→ afterCreate
 * 默认 beforeCommit 返回 true（进入静态图）。
 * handoff 测试可通过 mockCreator.beforeCommitCreatedObject = () => false 阻止。
 * @param {Function} [onProcess] - 在 process() 中执行的自定义逻辑
 * @returns {Tool}
 */
function createMockCreator(onProcess) {
  return new (class extends Tool {
    constructor() {
      super();
      this.isObjectCreationCompleted = false;
    }

    process(packet, ctx) {
      if (onProcess) onProcess(packet, ctx);
      this.completeCreatedObject({ deviceContext: ctx });
    }

    /**
     * 完整的创建生命周期入口。
     * 被 handoff 通过钩子（beforeCommit / afterCreate）拦截。
     */
    completeCreatedObject(interaction) {
      if (this.beforeCommitCreatedObject?.(interaction) === false) {
        // handoff 模式：只 finalize，不 commit
        this.isObjectCreationCompleted = true;
      } else {
        // 独立模式：commit 到静态图
        this.isObjectCreationCompleted = true;
        interaction?.deviceContext?.board?.activeObjectManager?.apply?.(
          new Set([this.obj].filter(Boolean)),
        );
      }
      this.afterCompleteCreatedObject?.(interaction, this.obj);
    }

    beforeCommitCreatedObject(_interaction) {
      return true;
    }

    afterCompleteCreatedObject(interaction, obj) {
      this._emit?.("afterCreate", interaction, obj);
    }

    obj;
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
 * 支持修改生命周期钩子，默认 applyModifiedObjects 会触发 afterApply。
 * @param {Function} [onProcess] - 在 process() 中执行的自定义逻辑
 * @returns {Tool}
 */
function createMockModifier(onProcess) {
  return new (class extends Tool {
    process(packet, ctx) {
      if (onProcess) onProcess(packet, ctx);
    }

    applyModifiedObjects(modificationContext, objects) {
      const normalized = Array.isArray(objects)
        ? objects
        : objects
          ? [objects]
          : [];
      if (normalized.length === 0) return false;
      if (
        this.beforeApplyModifiedObjects?.(modificationContext, normalized) ===
        false
      ) {
        return false;
      }
      this.afterApplyModifiedObjects?.(modificationContext, normalized, true);
      return true;
    }

    beforeApplyModifiedObjects() {
      return true;
    }

    afterApplyModifiedObjects(ctx, objects) {
      this._emit?.("afterApply", ctx, objects, true);
    }
  })();
}

export {
  CollectingTool,
  createMockCreator,
  createMockChooser,
  createMockModifier,
};
