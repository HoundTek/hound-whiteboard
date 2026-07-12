/**
 * @file 随机圆 workflow 挂载
 * @description 将 Space 键通过边级 prefix 接入随机圆子图。
 * @module templates/demo/workflows/random-circle
 * @author Zhou Chenyu
 */

import { createEdgePrefix } from "../../../core/ui/devices-dag/prefixes/index.js";
import { createRandomCircleSubDAG } from "../random-circle-creator-tool.js";
import { buildKeyboardTriggerForwardNodeConfig } from "../prefix-builders.js";
import {
  DEMO_WORKFLOW_NAMES,
  RANDOM_CIRCLE_KEY,
} from "../constants.js";

/**
 * 挂载随机圆 workflow
 * @description Space 键的 trigger 信号经转发 prefix 进入随机圆子图，由子图内部生成随机参数并创建圆对象。
 * @param {import("../../../core/ui/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @returns {void}
 */
function mountRandomCircle(viewport) {
  const randomCircleSubDAG = createRandomCircleSubDAG({
    rootPath: `/workflows/${DEMO_WORKFLOW_NAMES.RANDOM_CIRCLE}`,
  });

  viewport.mountWorkflow(DEMO_WORKFLOW_NAMES.RANDOM_CIRCLE, randomCircleSubDAG, [
    {
      from: `keyboard/code/${RANDOM_CIRCLE_KEY}`,
      edge: "default",
      prefix: createEdgePrefix(buildKeyboardTriggerForwardNodeConfig()),
    },
  ]);
}

export { mountRandomCircle };
