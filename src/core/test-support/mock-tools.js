/**
 * @file 模拟工具对象
 * @description 提供测试中通用的 Tool 模拟类与工厂函数。减少测试文件间的重复定义。
 * @module core/test-support/mock-tools
 * @author Zhou Chenyu
 */

import { GestureTool } from "../ui-thread/devices-dag/tools/gesture-tool.js";
import { Tool } from "../ui-thread/devices-dag/tools/tool.js";

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

  process(signalPacket, context) {
    this.calls.push({ signalPacket, context });
  }

  reset() {
    this.calls = [];
  }
}

/**
 * 创建模拟 creator 工具
 * @description
 * 基于 GestureTool 提供最小化的 creator 生命周期模拟。
 * `completeCreatedObject` 通过 `action:complete` 通知完成，
 * handoff 测试可通过 `beforeCommitCreatedObject = () => false` 阻止静态图提交。
 * @param {Function} [onProcess] - 在 process() 中执行的自定义逻辑
 * @returns {GestureTool}
 */
function createMockCreator(onProcess) {
  return new (class extends GestureTool {
    constructor() {
      super();
      this.isObjectCreationCompleted = false;
      this.autoActionOnGestureEnd = true;
    }

    process(packet, ctx) {
      if (onProcess) onProcess(packet, ctx);
      this.completeCreatedObject({ context: ctx, signalPacket: packet });
    }

    beginGesture() {}

    updateGesture() {}

    performAction() {
      return this._entry ?? this.obj;
    }

    /**
     * 完整的创建生命周期入口。
     * 被 handoff 通过钩子（beforeCommit / action:complete）拦截。
     * @param {{ context?: Object }} interaction - 交互上下文
     * @returns {undefined}
     */
    completeCreatedObject(interaction) {
      const draft = this._entry ?? this.obj;
      if (this.beforeCommitCreatedObject?.(interaction) === false) {
        this.isObjectCreationCompleted = true;
      } else {
        this.isObjectCreationCompleted = true;
        interaction?.context?.services?.board?.activeObjectManager?.apply?.(
          new Set([draft].filter(Boolean)),
        );
      }
      this.afterCompleteCreatedObject?.(interaction, draft);
      this._emit?.("action:complete", interaction?.context ?? {}, draft);
      return undefined;
    }

    beforeCommitCreatedObject(_interaction) {
      return true;
    }

    afterCompleteCreatedObject(interaction, obj) {}

    reset() {
      this.isObjectCreationCompleted = false;
    }

    obj;
  })();
}

/**
 * 创建模拟 chooser 工具
 * @description
 * 基于 GestureTool 提供最小化的 chooser 生命周期模拟。
 * `confirmSelection` 通过 `action:complete` 通知完成。
 * @param {Function} [onProcess] - 在 process() 中执行的自定义逻辑
 * @returns {GestureTool}
 */
function createMockChooser(onProcess) {
  return new (class extends GestureTool {
    constructor() {
      super();
      this.autoActionOnGestureEnd = false;
    }

    process(packet, ctx) {
      if (onProcess) onProcess(packet, ctx);

      const sigs = packet?.signals ?? [];
      const hasEnd = Array.isArray(sigs) && sigs.some((s) => s?.type === "end");
      if (hasEnd) {
        const nodeState = ctx.getNodeState?.(ctx.path) ?? {};
        const objects = nodeState?.objects ?? [];
        if (objects.length > 0) {
          this.confirmSelection?.(ctx, objects);
        }
      }
    }

    beginGesture() {}

    updateGesture() {}

    performAction() {
      return undefined;
    }

    beforeConfirmSelection() {
      return true;
    }

    afterConfirmSelection(deviceContext, objects) {}

    confirmSelection(deviceContext, objects) {
      if (this.beforeConfirmSelection(deviceContext) === false) return false;
      this.afterConfirmSelection(deviceContext, objects);
      this._emit?.("action:complete", deviceContext, objects);
      return true;
    }

    reset() {}
  })();
}

/**
 * 创建模拟 modifier 工具
 * @description
 * 基于 GestureTool 提供最小化的 modifier 生命周期模拟。
 * `applyModifiedObjects` 通过 `action:complete` 通知完成。
 * @param {Function} [onProcess] - 在 process() 中执行的自定义逻辑
 * @returns {GestureTool}
 */
function createMockModifier(onProcess) {
  return new (class extends GestureTool {
    /**
     * handoff 桥接的对象缓存，类似真实 ObjectModifierTool._overlayModifiedObjects
     * @type {Array<*>}
     */
    _handoffObjects = [];

    constructor() {
      super();
      this.autoActionOnGestureEnd = false;
    }

    /**
     * 接收 handoff 桥接对象
     * @param {Array<*>} objects
     * @param {Object} [_context={}]
     */
    receiveHandoffObjects(objects, _context = {}) {
      this._handoffObjects = Array.isArray(objects) ? [...objects] : [];
    }

    process(packet, ctx) {
      // 将 handoff 桥接的对象同步到节点状态（类似真实 modifier resolveActiveModifiedObjects 后的 setContextObjects）
      if (this._handoffObjects.length > 0) {
        ctx.setNodeState?.(ctx.path, {
          objects: [...this._handoffObjects],
          touched: true,
        });
        this._handoffObjects = [];
      }

      if (onProcess) onProcess(packet, ctx);
      const sigs = packet?.signals ?? [];
      const hasCancel =
        Array.isArray(sigs) && sigs.some((signal) => signal?.type === "cancel");
      if (hasCancel) {
        this._emit?.("gesture:cancel", { context: ctx, signals: sigs });
      }
    }

    beginGesture() {}

    updateGesture() {}

    performAction() {
      return true;
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
      this._emit?.("action:complete", modificationContext, true);
      this.afterApplyModifiedObjects?.(modificationContext, normalized, true);
      return true;
    }

    beforeApplyModifiedObjects() {
      return true;
    }

    afterApplyModifiedObjects(ctx, objects) {}

    discardAction(context = {}) {
      const objects = context.getNodeState?.(context.path)?.objects ?? [];
      const objectIds = objects
        .map((objectEntry) =>
          typeof objectEntry?.id === "number" ? objectEntry.id : null,
        )
        .filter((objectId) => objectId != null);
      if (objectIds.length > 0) {
        context.services?.boardApi?.discardActiveObjects?.(objectIds);
      }
    }

    reset() {}
  })();
}

export {
  CollectingTool,
  createMockCreator,
  createMockChooser,
  createMockModifier,
};
