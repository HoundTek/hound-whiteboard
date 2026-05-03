/**
 * 对象创建工具
 * @module core/tools/creator/obj-creator
 * @author Zhou Chenyu
 */

import { Vector } from "../../../utils/math.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { Controller } from "../controller/controller.js";
import { Tool } from "../tool.js";

const OBJECT_CREATOR_SIGNAL_TYPES = Object.freeze({
  POSITION: "position",
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
   * @param {{to: string, signals: Array<{type: string, context?: Object}>}} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {Object} 交互上下文
   */
  buildInteractionContext(signalPacket, deviceContext = {}) {
    const signals = signalPacket.signals;
    const positionSignal = signals.find(
      (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.POSITION,
    );
    const position = ObjectCreatorTool.normalizeVector(
      positionSignal?.context?.value ?? positionSignal?.context?.position,
    );
    return {
      signalPacket,
      deviceContext,
      signals,
      position,
      isEnded: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.END,
      ),
      isCancelled: signals.some(
        (signal) => signal.type === OBJECT_CREATOR_SIGNAL_TYPES.CANCEL,
      ),
      objectId:
        positionSignal?.context?.objectId ??
        deviceContext.objectId ??
        deviceContext.allocateObjectId?.(),
      pageId:
        positionSignal?.context?.pageId ??
        deviceContext.pageId ??
        deviceContext.resolvePageId?.(signalPacket),
    };
  }

  /**
   * 处理一个完整信号包。
   * @param {{to?: string, signals?: Array<Object>}} signalPacket - 输入信号包
   * @param {Object} deviceContext - 设备上下文
   * @returns {Array<{to: string, signals: Array<Object>}>} 输出信号包列表
   */
  process(signalPacket, deviceContext = {}) {
    const normalizedPacket = Tool.normalizeSignalPacket(signalPacket);
    const interaction = this.buildInteractionContext(
      normalizedPacket,
      deviceContext,
    );

    if (interaction.isCancelled) {
      this.cancelObjectCreation(interaction);
      this.isCreatingGestureActive = false;
      return [];
    }

    if (!interaction.position) {
      if (interaction.isEnded && this.isCreatingGestureActive) {
        this.completeObjectCreation(interaction);
        this.isCreatingGestureActive = false;
      }
      return [];
    }

    if (!this.obj) {
      if (interaction.objectId == null || interaction.pageId == null) {
        return [];
      }
      this.create(interaction.position, interaction.objectId, interaction.pageId);
    }

    if (!this.isCreatingGestureActive) {
      this.beginObjectCreation(interaction);
      this.isCreatingGestureActive = true;
    } else {
      this.updateObjectCreation(interaction);
    }

    if (interaction.isEnded) {
      this.completeObjectCreation(interaction);
      this.isCreatingGestureActive = false;
    }

    return [];
  }

  /**
   * @returns {Controller[]} 控制点列表
   */
  getControllers() {
    throw new Error("Method not implemented.");
  }

  /**
   * 开始一次对象创建手势。
   * @param {Object} interaction - 当前交互上下文
   */
  beginObjectCreation(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 更新一次对象创建手势。
   * @param {Object} interaction - 当前交互上下文
   */
  updateObjectCreation(interaction) {
    throw new Error("Method not implemented.");
  }

  /**
   * 完成一次对象创建手势。
   * @param {Object} interaction - 当前交互上下文
   */
  completeObjectCreation(interaction) {
    return undefined;
  }

  /**
   * 取消当前对象创建。
   * @param {Object} interaction - 当前交互上下文
   */
  cancelObjectCreation(interaction) {
    this.reset();
    return undefined;
  }

  /**
   * 创建新的对象实例
   * @param {Vector} position - 新对象的位置
   * @param {number} id - 新对象的 id
   * @param {number} pageId - 新对象所在的页 id
   * @description 在用户使用该工具创建新对象（而不是编辑正在创建的对象）时调用此方法以生成新的对象实例
   * @abstract
   */
  create(position, id, pageId) {
    throw new Error("Method not implemented.");
  }
}

export {
  ObjectCreatorTool,
  OBJECT_CREATOR_SIGNAL_TYPES,
};
