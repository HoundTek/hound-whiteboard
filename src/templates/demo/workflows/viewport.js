/**
 * @file 视口控制 workflow 挂载
 * @description 将方向键、+/-、R 通过边级 prefix 汇聚到共享视口工具。
 * @module templates/demo/workflows/viewport
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
 * @param {import("../../../core/ui/components/orchestration/viewport.js").Viewport} viewport - 视口实例
 * @param {import("../viewport-tool.js").ViewportTool} viewportTool - 视口工具实例
 * @returns {void}
 */
function mountViewportControl(viewport, viewportTool) {
  const factor = DEMO_VIEWPORT_SCALE_FACTOR;
  const step = DEMO_VIEWPORT_POSITION_STEP;

  const positionEdges = VIEWPORT_POSITION_KEYS.map(({ code, direction }) => ({
    from: `keyboard/code/${code}`,
    edge: "default",
    prefix: createEdgePrefix(buildViewportPositionNodeConfig(direction, step)),
  }));

  const scaleEdges = VIEWPORT_SCALE_KEYS.map(({ code, scale }) => ({
    from: `keyboard/code/${code}`,
    edge: "default",
    prefix: createEdgePrefix(
      buildViewportScaleNodeConfig(
        scale === "in"
          ? (zoom) => zoom / factor
          : (zoom) => zoom * factor,
      ),
    ),
  }));

  const flushEdges = VIEWPORT_FLUSH_KEYS.map((code) => ({
    from: `keyboard/code/${code}`,
    edge: "default",
    prefix: createEdgePrefix(buildViewportFlushNodeConfig()),
  }));

  viewport.mountWorkflow(DEMO_WORKFLOW_NAMES.VIEWPORT, viewportTool, [
    ...positionEdges,
    ...scaleEdges,
    ...flushEdges,
  ]);
}

export { mountViewportControl };
