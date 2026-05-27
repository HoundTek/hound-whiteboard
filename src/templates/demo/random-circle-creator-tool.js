/**
 * @file demo 随机圆修饰节点工作流
 * @description 提供随机圆参数 prefix 与圆对象创建工具的组合实现。
 * @module templates/demo/random-circle-creator-tool
 * @author Zhou Chenyu
 */

import { createSubTree } from "../../core/devices/devices-tree.js";
import { createPrefixNodeHandler } from "../../core/devices/prefix-node.js";
import { SignalPacket } from "../../core/devices/signal.js";
import { CircleCreatorTool } from "../../core/tools/creator/circle-creator.js";

/**
 * 随机圆 prefix 工作流信号类型
 * @readonly
 * @enum {string}
 */
const RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES = Object.freeze({
  RADIUS: "radius",
  PROPERTY: "circle-property",
});

/**
 * 判断值是否为纯对象
 * @param {any} value - 待判断值
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * Demo 专用随机圆对象创建工具
 * @class
 * @extends CircleCreatorTool
 */
class RandomCircleCreatorTool extends CircleCreatorTool {
  /**
   * @param {{
   *   random?: () => number,
   *   minRadius?: number,
   *   maxRadius?: number,
   *   property?: Record<string, any>,
   * }} [options={}]
   */
  constructor(options = {}) {
    super({ property: options.property ?? {} });
    this.random =
      typeof options.random === "function" ? options.random : Math.random;
    this.minRadius = options.minRadius ?? 12;
    this.maxRadius = options.maxRadius ?? 60;
    this.hasCustomStrokeColor = Boolean(
      options.property && Object.hasOwn(options.property, "strokeColor"),
    );
    this.pendingCircleProperty = null;
  }

  /**
   * @type {() => number}
   */
  random;

  /**
   * @type {number}
   */
  minRadius;

  /**
   * @type {number}
   */
  maxRadius;

  /**
   * @type {Record<string, any>}
   */
  property;

  /**
   * @type {boolean}
   */
  hasCustomStrokeColor;

  /**
   * 当前待写入新圆对象的属性覆盖
   * @type {Record<string, any>|null}
   */
  pendingCircleProperty;

  /**
   * 解析一次随机圆生成载荷
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {{ position: {x: number, y: number}, radius: number, property: Record<string, any> }|undefined}
   */
  resolveRandomCirclePayload(deviceContext = {}) {
    const monitor = deviceContext.monitor;
    const viewportWorldRect = monitor?.getViewportWorldRect?.();
    if (!viewportWorldRect) return undefined;

    const radiusRange = Math.max(this.maxRadius - this.minRadius, 0);
    const radius = this.minRadius + this.random() * radiusRange;
    const centerX =
      viewportWorldRect.left +
      radius +
      this.random() * Math.max(viewportWorldRect.width - radius * 2, 0);
    const centerY =
      viewportWorldRect.top +
      radius +
      this.random() * Math.max(viewportWorldRect.height - radius * 2, 0);
    const randomStrokeColor = `hsl(${Math.floor(this.random() * 360)}, 70%, 42%)`;
    return {
      position: { x: centerX, y: centerY },
      radius,
      property: {
        ...this.property,
        strokeColor: this.hasCustomStrokeColor
          ? this.property.strokeColor
          : randomStrokeColor,
      },
    };
  }

  /**
   * 将随机圆载荷转换为 CircleCreatorTool 可消费的包序列
   * @param {{ position: {x: number, y: number}, radius: number, property: Record<string, any> }} payload - 随机圆载荷
   * @param {string} [targetPath=""] - 目标路径
   * @returns {Array<{to: string, signals: Array<Object>}>}
   */
  createCirclePackets(payload, targetPath = "") {
    if (
      !payload ||
      !payload.position ||
      typeof payload.position.x !== "number" ||
      typeof payload.position.y !== "number" ||
      typeof payload.radius !== "number"
    ) {
      return [];
    }

    return [
      {
        to: targetPath,
        signals: [
          {
            type: "position",
            context: { value: payload.position },
          },
          {
            type: RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.PROPERTY,
            context: { value: payload.property },
          },
        ],
      },
      {
        to: targetPath,
        signals: [
          {
            type: "position",
            context: {
              value: {
                x: payload.position.x + payload.radius,
                y: payload.position.y,
              },
            },
          },
          {
            type: "end",
            context: {
              sourceType: "random-circle-prefix",
            },
          },
        ],
      },
    ];
  }

  /**
   * 基于当前工具配置创建随机圆 prefix 工作流
   * @param {string} [rootPath] - 工作流根路径
   * @returns {import("../../core/devices/devices-tree.js").SubTreeDefinition}
   */
  createSubTreeDefinition(rootPath) {
    return createSubTree(rootPath)
      .node("")
      .prefix(
        createPrefixNodeHandler({
          handle: (signalPacket, prefixContext = {}) => {
            const packet = SignalPacket.from(signalPacket);
            const hasTriggerSignal = packet.signals.some(
              (signal) => signal.type === "trigger",
            );

            if (!hasTriggerSignal) {
              return [];
            }

            const payload = this.resolveRandomCirclePayload({
              monitor: prefixContext.runtimeContext?.monitor,
            });
            if (!payload) {
              return [];
            }

            return prefixContext.routeToChild("params", [
              {
                type: "position",
                context: { value: payload.position },
              },
              {
                type: RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.RADIUS,
                context: { value: payload.radius },
              },
              {
                type: RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.PROPERTY,
                context: { value: payload.property },
              },
            ]);
          },
        }),
        {
          prefixKind: "random-circle-generator",
          routePolicy: "inject",
        },
      )
      .defaultChild("params")
      .node("params")
      .prefix(
        createPrefixNodeHandler({
          handle: (signalPacket, prefixContext = {}) => {
            const packet = SignalPacket.from(signalPacket);
            const positionSignal = packet.signals.find(
              (signal) => signal.type === "position",
            );
            const radiusSignal = packet.signals.find(
              (signal) =>
                signal.type === RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.RADIUS,
            );
            const propertySignal = packet.signals.find(
              (signal) =>
                signal.type === RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.PROPERTY,
            );
            const position = positionSignal?.context?.value;
            const radius = radiusSignal?.context?.value;

            if (
              !position ||
              typeof position.x !== "number" ||
              typeof position.y !== "number" ||
              typeof radius !== "number"
            ) {
              return [];
            }

            return this.createCirclePackets(
              {
                position,
                radius,
                property: isPlainObject(propertySignal?.context?.value)
                  ? propertySignal.context.value
                  : { ...this.property },
              },
              prefixContext.eventContext?.defaultChild || "tool",
            );
          },
        }),
        {
          prefixKind: "circle-params",
          routePolicy: "transform",
        },
      )
      .defaultChild("tool")
      .node("tool")
      .tool(this)
      .end()
      .end()
      .end()
      .build();
  }

  /**
   * 从信号包中提取随机圆属性覆盖
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {Object}
   */
  buildInteractionContext(signalPacket, deviceContext = {}) {
    const interaction = super.buildInteractionContext(
      signalPacket,
      deviceContext,
    );
    const propertySignal = interaction.signals.find(
      (signal) => signal.type === RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.PROPERTY,
    );
    interaction.circleProperty = isPlainObject(propertySignal?.context?.value)
      ? { ...propertySignal.context.value }
      : null;
    return interaction;
  }

  /**
   * 确保对象创建前缓存本次属性覆盖
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean}
   */
  ensureObject(interaction) {
    this.pendingCircleProperty = interaction?.circleProperty ?? null;
    return super.ensureObject(interaction);
  }

  /**
   * 创建新圆对象并写入 prefix 注入的属性
   * @param {import("../../core/utils/math.js").Vector} position - 圆心位置
   * @param {number} id - 对象 id
   * @param {number} ownerChunkId - 归属区块 id
   * @returns {void}
   */
  create(position, id, ownerChunkId) {
    super.create(position, id, ownerChunkId);
    if (this.pendingCircleProperty) {
      this.obj.setProperty(this.pendingCircleProperty);
    }
    this.pendingCircleProperty = null;
  }

  /**
   * 兼容直接挂载为单工具时的旧行为
   * @param {SignalPacket|Object} signalPacket - 输入信号包
   * @param {Object} [deviceContext={}] - 设备上下文
   * @returns {void}
   */
  process(signalPacket, deviceContext = {}) {
    const packet = SignalPacket.from(signalPacket);
    const hasPositionSignal = packet.signals.some(
      (signal) => signal.type === "position",
    );

    if (hasPositionSignal) {
      return super.process(packet, deviceContext);
    }

    const hasTriggerSignal = packet.signals.some(
      (signal) => signal.type === "trigger",
    );
    if (!hasTriggerSignal) {
      return;
    }

    const payload = this.resolveRandomCirclePayload(deviceContext);
    if (!payload) {
      return;
    }

    for (const nextPacket of this.createCirclePackets(payload)) {
      super.process(nextPacket, deviceContext);
    }
  }

  /**
   * 重置临时状态
   * @returns {void}
   */
  reset() {
    this.pendingCircleProperty = null;
    super.reset();
  }
}

export { RandomCircleCreatorTool, RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES };
