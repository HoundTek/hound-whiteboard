/**
 * @file canvas 相对坐标→世界坐标转换 prefix
 * @description 将 position 信号的 context.value 从 canvas 相对坐标转为世界坐标。
 * 视口实例来自 ctx.acc.viewport（由上游 `/<viewportId>` 节点注入）。
 * @module core/ui/devices-dag/prefixes/canvas-to-world-handler
 * @author Zhou Chenyu
 */

import { Vector } from "../../../utils/math.js";
import { createPrefixNodeHandler } from "./handler.js";

/**
 * 创建 canvas 相对坐标→世界坐标转换修饰节点处理器
 * @description
 * 遍历输入信号包中的 position 信号，取出 context.value（应为 canvas 相对坐标
 * Vector 或 { x, y }，即 DOM 坐标减去 canvas.getBoundingClientRect().left/top），
 * 用视口的 origin + zoom 直接转为世界坐标，替换回 value。
 * 非 position 信号原样透传。视口不可达时原样透传所有信号。
 * @returns {import("../dag.js").DevicesDAGHandler} 可挂载到 DevicesDAG 节点上的处理器函数
 *
 * @example
 * // 作为 edge prefix 插入 mouse device 与 workflow 之间
 * const prefix = createEdgePrefix({
 *   handler: createCanvasToWorldPrefixHandler(),
 * });
 */
function createCanvasToWorldPrefixHandler() {
  return createPrefixNodeHandler({
    handle(packet, ctx) {
      const viewport = ctx.acc?.viewport;

      if (!viewport || typeof viewport.zoom !== "number") {
        return ctx.routeToChild(ctx.defaultRoute || "", packet.signals);
      }

      const transformedSignals = packet.signals.map((signal) => {
        if (signal.type === "position" && signal.context?.value) {
          const raw = signal.context.value;
          const canvasPos =
            raw instanceof Vector ? raw : new Vector(raw.x, raw.y);

          const worldPos = new Vector(
            canvasPos.x / viewport.zoom + viewport.origin.x,
            canvasPos.y / viewport.zoom + viewport.origin.y,
          );

          return {
            ...signal,
            context: { ...signal.context, value: worldPos },
          };
        }
        return signal;
      });

      return ctx.routeToChild(ctx.defaultRoute || "", transformedSignals);
    },
  });
}

export { createCanvasToWorldPrefixHandler };
