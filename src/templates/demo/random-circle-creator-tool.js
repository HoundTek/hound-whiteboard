/**
 * @file demo 随机圆修饰节点工作流
 * @description 提供 createRandomCircleSubTree 工厂函数，生成完整的随机圆 prefix 工作流。
 * @module templates/demo/random-circle-creator-tool
 * @author Zhou Chenyu
 */

import { createSubTree } from "../../core/devices/devices-tree.js";
import { createPrefixNodeHandler } from "../../core/prefixs/index.js";
import { SignalPacket } from "../../core/devices/signal.js";
import { CircleCreatorTool } from "../../core/tools/creator/circle-creator.js";
import { Vector } from "../../core/utils/math.js";
import { isPlainObject } from "../../core/prefixs/utils.js";

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
 * 属性感知的圆创建工具
 * @class
 * @extends CircleCreatorTool
 */
class PropertyAwareCircleCreator extends CircleCreatorTool {
  /**
   * @param {Record<string, any>} [baseProperty={}] - 基础属性模板
   */
  constructor(baseProperty = {}) {
    super({ property: baseProperty });
    /** @type {Record<string, any>|null} */
    this._pendingProperty = null;
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
   * 缓存本次属性覆盖
   * @param {Object} interaction - 当前交互上下文
   * @returns {boolean}
   */
  ensureObject(interaction) {
    this._pendingProperty = interaction?.circleProperty ?? null;
    return super.ensureObject(interaction);
  }

  /**
   * 创建圆对象并写入 prefix 注入的属性
   * @param {Vector} position - 圆心位置
   * @param {number} id - 对象 id
   * @param {number} ownerChunkId - 归属区块 id
   */
  create(position, id, ownerChunkId) {
    super.create(position, id, ownerChunkId);
    if (this._pendingProperty) {
      this.obj.setProperty(this._pendingProperty);
    }
    this._pendingProperty = null;
  }
}

/**
 * 创建随机圆修饰节点工作流
 * @description
 *   工厂函数，接收配置选项后一次性生成包含 random-circle-generator prefix、
 *   circle-params prefix 和 CircleCreatorTool 的三层修饰节点子树。
 *   无需手动实例化工具类，挂载后任意 trigger 信号即可生成随机圆。
 * @param {{
 *   rootPath: string,
 *   random?: () => number,
 *   minRadius?: number,
 *   maxRadius?: number,
 *   property?: Record<string, any>,
 * }} [options={}] - 随机圆工作流配置
 * @returns {import("../../core/devices/devices-tree.js").SubTreeDefinition} 可直接传入 monitor.mountSubTree(path, subTree) 的结构化子树定义
 *
 * @example
 *   const subTree = createRandomCircleSubTree({
 *     rootPath: "/keyboard/tools/random-circle",
 *     minRadius: 20,
 *     maxRadius: 80,
 *   });
 *   monitor.mountSubTree("", subTree);
 */
function createRandomCircleSubTree(options = {}) {
  const rootPath = options.rootPath ?? "/random-circle";
  const random =
    typeof options.random === "function" ? options.random : Math.random;
  const minRadius = options.minRadius ?? 12;
  const maxRadius = options.maxRadius ?? 60;
  const baseProperty = isPlainObject(options.property)
    ? { ...options.property }
    : {};
  const hasCustomStrokeColor = Boolean(
    options.property && Object.hasOwn(options.property, "strokeColor"),
  );

  const tool = new PropertyAwareCircleCreator(baseProperty);

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

          const monitor = prefixContext.runtimeContext?.monitor;
          const viewportWorldRect = monitor?.getViewportWorldRect?.();
          if (!viewportWorldRect) {
            return [];
          }

          const radiusRange = Math.max(maxRadius - minRadius, 0);
          const radius = minRadius + random() * radiusRange;
          const centerX =
            viewportWorldRect.left +
            radius +
            random() * Math.max(viewportWorldRect.width - radius * 2, 0);
          const centerY =
            viewportWorldRect.top +
            radius +
            random() * Math.max(viewportWorldRect.height - radius * 2, 0);
          const randomStrokeColor = `hsl(${Math.floor(random() * 360)}, 70%, 42%)`;

          return prefixContext.routeToChild("params", [
            {
              type: "position",
              context: { value: { x: centerX, y: centerY } },
            },
            {
              type: RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.RADIUS,
              context: { value: radius },
            },
            {
              type: RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.PROPERTY,
              context: {
                value: {
                  ...baseProperty,
                  strokeColor: hasCustomStrokeColor
                    ? baseProperty.strokeColor
                    : randomStrokeColor,
                },
              },
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

          const target = prefixContext.eventContext?.defaultChild || "tool";

          return [
            {
              to: target,
              signals: [
                {
                  type: "position",
                  context: { value: position },
                },
                {
                  type: RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.PROPERTY,
                  context: {
                    value: isPlainObject(propertySignal?.context?.value)
                      ? propertySignal.context.value
                      : { ...baseProperty },
                  },
                },
              ],
            },
            {
              to: target,
              signals: [
                {
                  type: "position",
                  context: {
                    value: {
                      x: position.x + radius,
                      y: position.y,
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
        },
      }),
      {
        prefixKind: "circle-params",
        routePolicy: "transform",
      },
    )
    .defaultChild("tool")
    .node("tool")
    .tool(tool)
    .end()
    .end()
    .end()
    .build();
}

export { createRandomCircleSubTree };
