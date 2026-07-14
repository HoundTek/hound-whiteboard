/**
 * @file 随机圆 workflow 挂载
 * @description 将 Space 键通过边级 prefix 接入随机圆子图。
 * @module demo/config/workflows/random-circle
 * @author Zhou Chenyu
 */

import { createEdgePrefix } from "../../../core/ui-thread/devices-dag/prefixes/index.js";
import { createRandomCircleSubDAG } from "../random-circle-creator-tool.js";
import { buildKeyboardTriggerForwardNodeConfig } from "../prefix-builders.js";
import { DEMO_WORKFLOW_NAMES, RANDOM_CIRCLE_KEY } from "../constants.js";

/**
 * 挂载随机圆 workflow
 * @description Space 键的 trigger 信号经转发 prefix 进入随机圆子图，由子图内部生成随机参数并创建圆对象。
 * @param {import("../../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @returns {void}
 */
function mountRandomCircle(viewport) {
  const scope = viewport.inputScope;
  const wfName = DEMO_WORKFLOW_NAMES.RANDOM_CIRCLE;

  const randomCircleSubDAG = createRandomCircleSubDAG({
    rootPath: `/workflows/${wfName}`,
  });

  scope.mountWorkflow(wfName, randomCircleSubDAG);
  scope.addEdge({
    from: `keyboard/code/${RANDOM_CIRCLE_KEY}`,
    to: `workflows/${wfName}`,
    prefix: createEdgePrefix(buildKeyboardTriggerForwardNodeConfig()),
  });
}

export { mountRandomCircle };
