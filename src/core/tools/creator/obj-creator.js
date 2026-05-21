/**
 * 对象创建工具
 * @module core/tools/creator/obj-creator
 * @author Zhou Chenyu
 */

import { Vector } from "../../utils/math.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { SignalPacket } from "../../devices/signal.js";
import { Tool } from "../tool.js";

/**
 * 对象创建工具相关信号类型常量
 * @readonly
 * @enum {string}
 * @description
 * 定义对象创建工具处理的信号类型，包括位置更新、手势结束/取消、对象结束/取消等。
 * 这些信号类型用于工具在处理输入时识别不同的交互阶段和事件。
 * @author Zhou Chenyu
 */
const OBJECT_CREATOR_SIGNAL_TYPES = Object.freeze({
  POSITION: "position",
  GESTURE_END: "end",
  GESTURE_CANCEL: "cancel",
  OBJECT_END: "object-end",
  OBJECT_CANCEL: "object-cancel",
  END: "end",
  CANCEL: "cancel",
});

/**
 * 对象创建工具基类
 * @class
 * @abstract
 * @extends Tool
 * @description
 * 对象创建工具是用于在白板上创建各种对象的工具的基类。
 * 具体的对象创建工具应继承此类并实现其特定功能。
 * 例如，矩形创建工具用于创建矩形对象，圆形创建工具用于创建圆形对象等。
 * 这些工具通常允许用户通过点击和拖动来定义对象的位置和大小。
 * @author Zhou Chenyu
 */
class ObjectCreatorTool extends Tool {
  /**
   * @constructor
   */
  constructor() {
    super();
    this.isCreatingGestureActive = false;
  }

  /**
   * 解析序列化的对象生成工具数据以创建工具实例
   * @static
   * @abstract
   * @param {Object} toolData - 序列化的工具数据
   * @returns {ObjectCreatorTool} 创建的对象生成工具实例
   */
  static parse(toolData) {
    throw new Error("Method not implemented.");
  }

  /**
   * 序列化对象生成工具实例以保存工具数据
   * @abstract
   * @return {Object} 序列化后的对象生成工具数据
   */
  serialize() {
    throw new Error("Method not implemented.");
  }

  /**
   * 当前正在创建的对象
   * @type {BasicObject}
   */
  obj;

  /**
   * 当前创建手势是否仍在持续
   * @type {boolean}
   */
  isCreatingGestureActive;

  /**
   * 将信号上下文中的坐标规整为 Vector。
   * @param {*} value - 原始值
   * @returns {Vector|null} 规整后的向量
   */
  static normalizeVector(value) {
    if (!value) return null;
    if (value instanceof Vector) return value;
    if (typeof value.x === "number" && typeof value.y === "number") {
      return new Vector(value.x, value.y);
    }
    return null;
  }

  /**
   * 从信号包中提取交互上下文。
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {Object} 交互上下文
   */
  buildInteractionContext(signalPacket, deviceContext = {}) {
    const signals = signalPacket.signals;
    const positionSignal = signals.find(
      (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
    );
    const position =
      deviceContext.resolvePosition?.(signalPacket) ??
      ObjectCreatorTool.normalizeVector(
        positionSignal?.context?.value ?? positionSignal?.context?.position,
      );
    return {
      signalPacket,
      deviceContext,
      signals,
      position,
      isGestureEnded: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.GESTURE_END,
      ),
      isGestureCancelled: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.GESTURE_CANCEL,
      ),
      isObjectEnded: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_END,
      ),
      isObjectCancelled: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.OBJECT_CANCEL,
      ),
      objectId: positionSignal?.context?.objectId ?? deviceContext.objectId,
      ownerChunkId:
        positionSignal?.context?.ownerChunkId ??
        deviceContext.ownerChunkId ??
        deviceContext.resolveOwnerChunkId?.(position, signalPacket),
    };
  }

  /**
   * 确保当前交互已拥有对象实例。
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean} 是否已拥有对象实例
   */
  ensureObject(interaction) {
    if (!this.obj) {
      const objectId =
        interaction.objectId ??
        interaction?.deviceContext?.allocateObjectId?.();
      if (interaction.objectId == null || interaction.ownerChunkId == null) {
        if (objectId == null || interaction.ownerChunkId == null) {
          return false;
        }
      }
      interaction.objectId = objectId;
      this.create(interaction.position, objectId, interaction.ownerChunkId);
      interaction?.deviceContext?.board?.activeObjectManager?.add?.(
        new Set([this.obj]),
      );
    }

    return true;
  }

  /**
   * 处理一个完整信号包。
   * @param {SignalPacket} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   * @abstract
   */
  process(signalPacket, deviceContext = {}) {
    throw new Error("Method not implemented.");
  }

  /**
   * 开始一次创建手势。
   * @param {Object} interaction - 当前交互上下文
   */
  beginCreationGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 更新一次创建手势。
   * @param {Object} interaction - 当前交互上下文
   */
  updateCreationGesture(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 完成一次创建手势。
   * @param {Object} interaction - 当前交互上下文
   */
  completeCreationGesture(interaction) {
    return undefined;
  }

  /**
   * 取消当前创建手势。
   * @param {Object} interaction - 当前交互上下文
   */
  cancelCreationGesture(interaction) {
    return undefined;
  }

  /**
   * 完成整个对象创建。
   * @param {Object} interaction - 当前交互上下文
   */
  completeCreatedObject(interaction) {
    if (!this.obj) return undefined;
    const board = interaction?.deviceContext?.board;
    if (board?.activeObjectManager?.apply) {
      board.activeObjectManager.apply(new Set([this.obj]));
      return undefined;
    }
    board?.addObject?.(this.obj, this.obj.ownerChunkId);
    return undefined;
  }

  /**
   * 取消整个对象创建。
   * @param {Object} interaction - 当前交互上下文
   */
  cancelCreatedObject(interaction) {
    const board = interaction?.deviceContext?.board;
    if (this.obj) {
      if (board?.activeObjectManager?.discard) {
        board.activeObjectManager.discard(new Set([this.obj]));
      } else if (board?.activeObjectManager?.unregisterActiveObject) {
        board.activeObjectManager.unregisterActiveObject(this.obj.id);
      }
    }
    this.reset();
    return undefined;
  }

  /**
   * 创建新的对象实例
   * @param {Vector} position - 新对象的位置
   * @param {number} id - 新对象的 id
   * @param {number} ownerChunkId - 新对象归属区块 id
   * @description 在用户使用该工具创建新对象（而不是编辑正在创建的对象）时调用此方法以生成新的对象实例
   * @abstract
   */
  create(position, id, ownerChunkId) {
    throw new Error("Method not implemented.");
  }
}

/**
 * 单手势对象创建工具
 * @class
 * @abstract
 * @extends ObjectCreatorTool
 * @description
 * 一次对象创建只对应一个手势。手势结束即对象结束，手势取消即对象取消。
 */
class SingleGestureObjectCreatorTool extends ObjectCreatorTool {
  /**
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket);
    const interaction = this.buildInteractionContext(
      normalizedPacket,
      deviceContext,
    );

    if (interaction.isGestureCancelled) {
      this.cancelCreationGesture(interaction);
      this.cancelCreatedObject(interaction);
      this.isCreatingGestureActive = false;
      return;
    }

    if (!interaction.position) {
      if (interaction.isGestureEnded && this.isCreatingGestureActive) {
        this.completeCreationGesture(interaction);
        this.completeCreatedObject(interaction);
        this.isCreatingGestureActive = false;
      }
      return;
    }

    if (!this.ensureObject(interaction)) {
      return;
    }

    if (!this.isCreatingGestureActive) {
      this.beginCreationGesture(interaction);
      this.isCreatingGestureActive = true;
    } else {
      this.updateCreationGesture(interaction);
    }

    if (interaction.isGestureEnded) {
      this.completeCreationGesture(interaction);
      this.completeCreatedObject(interaction);
      this.isCreatingGestureActive = false;
    }
  }
}

/**
 * 多手势对象创建工具
 * @class
 * @abstract
 * @extends ObjectCreatorTool
 * @description
 * 一个对象由多个手势逐步完成。`end/cancel` 仅作用于当前手势，
 * `object-end/object-cancel` 才作用于整个对象。
 */
class MultiGestureObjectCreatorTool extends ObjectCreatorTool {
  /**
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const normalizedPacket = SignalPacket.from(signalPacket);
    const interaction = this.buildInteractionContext(
      normalizedPacket,
      deviceContext,
    );

    if (interaction.isObjectCancelled) {
      if (this.isCreatingGestureActive) {
        this.cancelCreationGesture(interaction);
      }
      this.cancelCreatedObject(interaction);
      this.isCreatingGestureActive = false;
      return;
    }

    if (interaction.isGestureCancelled) {
      if (this.isCreatingGestureActive) {
        this.cancelCreationGesture(interaction);
        this.isCreatingGestureActive = false;
      }
      return;
    }

    if (interaction.isObjectEnded) {
      if (this.isCreatingGestureActive) {
        this.completeCreationGesture(interaction);
        this.isCreatingGestureActive = false;
      }
      this.completeCreatedObject(interaction);
      return;
    }

    if (!interaction.position) {
      if (interaction.isGestureEnded && this.isCreatingGestureActive) {
        this.completeCreationGesture(interaction);
        this.isCreatingGestureActive = false;
      }
      return;
    }

    if (!this.ensureObject(interaction)) {
      return;
    }

    if (!this.isCreatingGestureActive) {
      this.beginCreationGesture(interaction);
      this.isCreatingGestureActive = true;
    } else {
      this.updateCreationGesture(interaction);
    }

    if (interaction.isGestureEnded) {
      this.completeCreationGesture(interaction);
      this.isCreatingGestureActive = false;
    }
  }
}

export {
  ObjectCreatorTool,
  SingleGestureObjectCreatorTool,
  MultiGestureObjectCreatorTool,
  OBJECT_CREATOR_SIGNAL_TYPES,
};
