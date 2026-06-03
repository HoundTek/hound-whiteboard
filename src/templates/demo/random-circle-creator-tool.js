/**
 * @file demo 随机圆修饰节点工作流
 * @description 提供 createRandomCircleSubDAG 工厂函数，生成完整的随机圆 prefix 工作流。
 * @module templates/demo/random-circle-creator-tool
 * @author Zhou Chenyu
 */

import { createSubDAG } from "../../core/devices-dag/index.js";
import { createPrefixNodeHandler } from "../../core/prefixs/index.js";
import { SignalPacket } from "../../core/devices-dag/signal.js";
import { CircleCreatorTool } from "../../core/tools/creator/circle-creator.js";
import { OBJECT_CREATOR_SIGNAL_TYPES } from "../../core/tools/creator/obj-creator.js";
import { Vector } from "../../core/utils/math.js";
import { isPlainObject } from "../../core/prefixs/utils.js";

/**
 * 随机圆 prefix 工作流信号类型
 * @readonly
 * @enum {string}
 */
const RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES = Object.freeze({
  RADIUS: "radius",
  PROPERTY: OBJECT_CREATOR_SIGNAL_TYPES.PROPERTY,
});

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
 * @returns {import("../../core/devices-dag/index.js").SubDAGDefinition} 可直接传入 monitor.mountSubDAG(path, subDAG) 的结构化子树定义
 *
 * @example
 *   const subDAG = createRandomCircleSubDAG({
 *     rootPath: "/workflows/random-circle",
 *     minRadius: 20,
 *     maxRadius: 80,
 *   });
 *   monitor.mountWorkflow("/workflows/random-circle", subDAG);
 */
function createRandomCircleSubDAG(options = {}) {
  const rootPath = options.rootPath ?? "/workflows/create-circle";
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

  const tool = new CircleCreatorTool({ property: baseProperty });

  const builder = createSubDAG(rootPath);
  const root = builder
    .node()
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

          const monitor = prefixContext.context?.monitor;
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
              type: OBJECT_CREATOR_SIGNAL_TYPES.PROPERTY,
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
    .defaultRoute("params");

  const paramsNode = builder
    .node()
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
              signal.type === OBJECT_CREATOR_SIGNAL_TYPES.PROPERTY,
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

          const target = prefixContext.defaultChild || "tool";

          return [
            {
              to: target,
              signals: [
                {
                  type: "position",
                  context: { value: position },
                },
                {
                  type: OBJECT_CREATOR_SIGNAL_TYPES.PROPERTY,
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
    .defaultRoute("tool");

  const toolNode = builder.node().tool(tool);

  builder.edge("params", root, paramsNode);
  builder.edge("tool", paramsNode, toolNode);

  return builder.build();
}

export { createRandomCircleSubDAG };
