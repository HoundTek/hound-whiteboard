/**
 * @file 拖拽锚点修饰节点处理器
 * @description
 * 将鼠标世界坐标序列转换为相对于手势起点的累计位移 (x, y)，
 * 以 "displacement" 信号输出给下游手势驱动的 modifier 工具（如 CommonObjectModifierTool）。
 *
 * modifier 消费 "displacement" 信号管理手势生命周期：
 * - 首个 displacement 信号 → 手势开始，记录对象初始位置，应用位移
 * - 后续 displacement 信号 → 直接以 initPos + {x, y} 更新对象
 * - end 信号 → 手势结束，对象保留在动态图
 * - success 信号 → 提交到静态图
 *
 * @module core/prefixs/drag-anchor-handler
 * @author Zhou Chenyu
 */

import { createPrefixNodeHandler } from "./handler.js";

/**
 * 创建拖拽锚点修饰节点处理器
 *
 * @description
 * 捕获首次鼠标世界坐标作为手势锚点，后续将世界坐标转换为从锚点出发的
 * 累计位移 `{x, y}`，以 `"displacement"` 信号输出。
 *
 * 工作流程：
 * 1. 收到首个 "position" 信号 → 记录锚点 (anchorX, anchorY)，不转发
 * 2. 收到后续 "position" 信号 → 计算累计位移 x = current.x − anchor.x,
 *    y = current.y − anchor.y，输出
 *    `{ type: "displacement", context: { value: { x, y } } }`
 * 3. 收到 "end" 信号 → 清空锚点，转发 end
 *
 * 下游 modifier（如 CommonObjectModifierTool）直接以 `initPos + {x, y}` 更新对象，
 * 无需内部累加。
 *
 * @param {{
 *   displacementSignalType?: string,
 * }} [options={}] - 配置选项
 * @param {string} [options.displacementSignalType="displacement"] - 输出信号的 type 字段值
 * @returns {import("../devices-dag/index.js").DevicesDAGHandler}
 *
 * @example
 *   // 手势驱动 modifier
 *   .prefix(createDragAnchorPrefixHandler())
 *   .defaultChild("tool")
 *   .node("tool")
 *   .tool(new CommonObjectModifierTool())
 *   .end()
 */
function createDragAnchorPrefixHandler(options = {}) {
  const { displacementSignalType = "displacement" } = options;

  return createPrefixNodeHandler({
    initialState: { anchor: null },
    handle(packet, ctx) {
      const signals = packet.signals ?? [];
      const positionSig = signals.find((s) => s?.type === "position");
      const endSig = signals.some((s) => s?.type === "end");

      if (endSig) {
        ctx.patchState({ anchor: null });
        return ctx.routeToChild(ctx.defaultChild || "", signals);
      }

      if (!positionSig) {
        return ctx.routeToChild(ctx.defaultChild || "", signals);
      }

      const worldPos = positionSig.context?.value;
      if (
        !worldPos ||
        typeof worldPos.x !== "number" ||
        typeof worldPos.y !== "number"
      ) {
        return [];
      }

      const state = ctx.state;
      const current = { x: worldPos.x, y: worldPos.y };

      if (!state.anchor) {
        ctx.patchState({ anchor: current });
        return [];
      }

      const x = current.x - state.anchor.x;
      const y = current.y - state.anchor.y;

      return [
        {
          to: ctx.defaultChild || "",
          signals: [
            { type: displacementSignalType, context: { value: { x, y } } },
          ],
        },
      ];
    },
  });
}

export { createDragAnchorPrefixHandler };
