/**
 * @file demo 随机圆修饰节点工作流
 * @description 提供 createRandomCircleSubDAG 工厂函数，生成完整的随机圆 prefix 工作流。
 * @module demo/config/random-circle-creator-tool
 * @author Zhou Chenyu
 */

import { createSubDAG } from "../../core/ui-thread/devices-dag/index.js";
import { createPrefixNodeHandler } from "../../core/ui-thread/devices-dag/prefixes/index.js";
import { SignalPacket } from "../../core/ui-thread/devices-dag/dag-core/signal.js";
import { CircleDataCreatorTool } from "../../core/ui-thread/devices-dag/tools/creator/circle/data-creator.js";
import { createCircleRadiusProcessor } from "../../core/ui-thread/devices-dag/tools/creator/circle/radius-processor.js";
import { SIGNAL_TYPES } from "../../core/ui-thread/devices-dag/dag-core/signal-types.js";
import { Vector } from "../../core/engine/utils/math.js";
import { isPlainObject } from "../../core/ui-thread/devices-dag/prefixes/utils.js";

/**
 * 随机圆 prefix 工作流信号类型
 * @readonly
 * @enum {string}
 */
const RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES = Object.freeze({
  RADIUS: "radius",
  PROPERTY: SIGNAL_TYPES.PROPERTY,
});

/**
 * 创建随机圆修饰节点工作流
 * @description
 * 工厂函数，接收配置选项后一次性生成包含 random-circle-generator prefix、
 * circle-params prefix 和 CircleDataCreatorTool 的三层修饰节点子树。
 * 无需手动实例化工具类，挂载后任意 trigger 信号即可生成随机圆。
 * @param {{
 *   rootPath: string,
 *   random?: () => number,
 *   minRadius?: number,
 *   maxRadius?: number,
 *   property?: Record<string, any>,
 * }} [options={}] - 随机圆工作流配置
 * @returns {import("../../core/devices-dag/dag-type.js").SubDAGDefinition} 可直接传入 inputScope.mountWorkflow(name, subDAG) 的结构化子树定义
 * @see CircleDataCreatorTool
 * @example
 * const subDAG = createRandomCircleSubDAG({
 *   rootPath: "/workflows/random-circle",
 *   minRadius: 20,
 *   maxRadius: 80,
 * });
 * inputScope.mountWorkflow("random-circle", subDAG);
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
  const hasCustomFillColor = Boolean(
    options.property && Object.hasOwn(options.property, "fillColor"),
  );

  const tool = new CircleDataCreatorTool({
    property: baseProperty,
    processor: createCircleRadiusProcessor(),
  });

  const builder = createSubDAG(rootPath);

  // 生成随机圆 prefix 节点，接收 trigger 信号并计算随机圆参数后路由到 params prefix
  const root = builder
    .node()
    .prefix(
      createPrefixNodeHandler({
        handle: (pkt, ctx = {}) => {
          const packet = SignalPacket.from(pkt);
          const hasTriggerSignal = packet.signals.some(
            (signal) => signal.type === "trigger",
          );
          if (!hasTriggerSignal) {
            return ctx.stop();
          }

          const viewport = ctx.services?.viewport;
          const viewportWorldRect = viewport?.getViewportWorldRect?.();
          if (!viewportWorldRect) {
            return ctx.stop();
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
          const hue = Math.floor(random() * 360);
          const randomStrokeColor = `hsl(${hue}, 70%, 42%)`;
          const randomFillColor = `hsla(${hue}, 75%, 60%, 0.22)`;

          return ctx.routeToChild("params", [
            ctx.signal("position", { x: centerX, y: centerY }),
            ctx.signal(RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.RADIUS, radius),
            ctx.signal(SIGNAL_TYPES.PROPERTY, {
              ...baseProperty,
              strokeColor: hasCustomStrokeColor
                ? baseProperty.strokeColor
                : randomStrokeColor,
              fillColor: hasCustomFillColor
                ? baseProperty.fillColor
                : randomFillColor,
            }),
          ]);
        },
      }),
      {
        prefixKind: "random-circle-generator",
        routePolicy: "inject",
      },
    )
    .defaultRoute("params");

  // circle-params prefix 节点，接收随机圆参数信号并转换为工具输入信号路由到 CircleDataCreatorTool
  const paramsNode = builder
    .node()
    .prefix(
      createPrefixNodeHandler({
        handle: (pkt, ctx = {}) => {
          const packet = SignalPacket.from(pkt);
          const positionSignal = packet.signals.find(
            (signal) => signal.type === "position",
          );
          const radiusSignal = packet.signals.find(
            (signal) =>
              signal.type === RANDOM_CIRCLE_PREFIX_SIGNAL_TYPES.RADIUS,
          );
          const propertySignal = packet.signals.find(
            (signal) => signal.type === SIGNAL_TYPES.PROPERTY,
          );
          const position = positionSignal?.context?.value;
          const radius = radiusSignal?.context?.value;

          if (
            !position ||
            typeof position.x !== "number" ||
            typeof position.y !== "number" ||
            typeof radius !== "number"
          ) {
            return ctx.stop();
          }

          const target = ctx.defaultRoute || "tool";

          const signalsA = [
            ctx.signal("position", position),
            ctx.signal(
              SIGNAL_TYPES.PROPERTY,
              isPlainObject(propertySignal?.context?.value)
                ? propertySignal.context.value
                : { ...baseProperty },
            ),
          ];

          const signalsB = [
            ctx.signal("position", {
              x: position.x + radius,
              y: position.y,
            }),
          ];

          const signalsC = [
            ctx.signal("position", {
              x: position.x + radius,
              y: position.y,
            }),
            ctx.signal("end", undefined, {
              sourceType: "random-circle-prefix",
            }),
          ];

          return {
            packets: [
              ...ctx.routeToChild(target, signalsA).packets,
              ...ctx.routeToChild(target, signalsB).packets,
              ...ctx.routeToChild(target, signalsC).packets,
            ],
          };
        },
      }),
      {
        prefixKind: "circle-params",
        routePolicy: "transform",
      },
    )
    .defaultRoute("tool");

  // CircleDataCreatorTool 节点，接收信号并创建圆对象
  const toolNode = builder.node().tool(tool);

  builder.edge("params", root, paramsNode);
  builder.edge("tool", paramsNode, toolNode);

  return builder.build();
}

export { createRandomCircleSubDAG };
