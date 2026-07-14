/**
 * @file 视口控制 workflow 挂载
 * @description 将方向键、+/-、R 通过边级 prefix 汇聚到共享视口工具。
 * @module demo/config/workflows/viewport
 * @author Zhou Chenyu
 */

import { createEdgePrefix } from "../../../core/ui-thread/devices-dag/prefixes/index.js";
import {
  buildViewportFlushNodeConfig,
  buildViewportPositionNodeConfig,
  buildViewportScaleNodeConfig,
} from "../prefix-builders.js";
import {
  DEMO_VIEWPORT_POSITION_STEP,
  DEMO_VIEWPORT_SCALE_FACTOR,
  DEMO_WORKFLOW_NAMES,
  VIEWPORT_FLUSH_KEYS,
  VIEWPORT_POSITION_KEYS,
  VIEWPORT_SCALE_KEYS,
} from "../constants.js";

/**
 * 挂载视口控制 workflow
 * @description 平移键转 position 信号、缩放键转 scale 信号、刷新键转 flush 信号，全部汇聚到视口工具。
 * @param {import("../../../core/ui-thread/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../viewport-tool.js").ViewportTool} viewportTool - 视口工具实例
 * @returns {void}
 */
function mountViewportControl(viewport, viewportTool) {
  const scope = viewport.inputScope;
  const wfName = DEMO_WORKFLOW_NAMES.VIEWPORT;
  const factor = DEMO_VIEWPORT_SCALE_FACTOR;
  const step = DEMO_VIEWPORT_POSITION_STEP;

  scope.mountWorkflow(wfName, viewportTool);

  for (const { code, direction } of VIEWPORT_POSITION_KEYS) {
    scope.addEdge({
      from: `keyboard/code/${code}`,
      to: `workflows/${wfName}`,
      prefix: createEdgePrefix(
        buildViewportPositionNodeConfig(direction, step),
      ),
    });
  }

  for (const { code, scale } of VIEWPORT_SCALE_KEYS) {
    scope.addEdge({
      from: `keyboard/code/${code}`,
      to: `workflows/${wfName}`,
      prefix: createEdgePrefix(
        buildViewportScaleNodeConfig(
          scale === "in" ? (zoom) => zoom / factor : (zoom) => zoom * factor,
        ),
      ),
    });
  }

  for (const code of VIEWPORT_FLUSH_KEYS) {
    scope.addEdge({
      from: `keyboard/code/${code}`,
      to: `workflows/${wfName}`,
      prefix: createEdgePrefix(buildViewportFlushNodeConfig()),
    });
  }
}

export { mountViewportControl };
