/**
 * @file 圆心半径手势处理器
 * @description 提供圆心+半径手势的 interpret 纯函数与 processor 工厂。
 * @module core/ui-thread/devices-dag/tools/creator/circle/radius-processor
 * @author Zhou Chenyu
 */

import { Vector } from "../../../../../engine/utils/math.js";
import { TwoPointGestureProcessor } from "../gesture/two-point-processor.js";

const DEFAULT_FIXED_RADIUS_SCREEN = 16;
const DEFAULT_MIN_DRAG_DISTANCE_SCREEN = 4;

/**
 * 圆心+半径手势解释函数
 * @description 锚点为圆心，当前点到锚点的距离为半径。
 * @param {Vector} anchor - 锚点（圆心）
 * @param {Vector} current - 当前点
 * @returns {import("../gesture/two-point-processor.js").GesturePatch} 半径补丁
 */
function interpretCircleRadius(anchor, current) {
  return { data: { radius: current.sub(anchor).length() } };
}

/**
 * 收集圆心+半径手势的 overlay 条目
 * @param {Vector} anchor - 锚点（圆心）
 * @param {Vector} current - 当前点
 * @returns {import("../../../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
 */
function collectCircleRadiusOverlay(anchor, current) {
  const result = [
    {
      source: "circle-center",
      type: "point",
      geometry: {
        worldPoint: anchor,
        radius: 4,
      },
      style: {
        fillStyle: "#33a1ff",
      },
    },
  ];

  if (current.sub(anchor).length() > 0) {
    result.push({
      source: "circle-radius",
      type: "path",
      geometry: {
        worldPoints: [anchor, current],
        closePath: false,
      },
      style: {
        strokeStyle: "#33a1ff",
        lineWidth: 1,
        lineDash: [4, 4],
      },
    });
  }

  return result;
}

/**
 * 创建圆心+半径手势处理器
 * @param {{
 *   fixedRadiusScreen?: number,
 *   minDragDistanceScreen?: number,
 * }} [options={}] - 点击兜底配置（屏幕坐标系）
 * @returns {TwoPointGestureProcessor} 配置好的两点手势处理器
 */
function createCircleRadiusProcessor(options = {}) {
  const fixedRadiusScreen = options.fixedRadiusScreen ?? DEFAULT_FIXED_RADIUS_SCREEN;
  const minDragDistanceScreen =
    options.minDragDistanceScreen ?? DEFAULT_MIN_DRAG_DISTANCE_SCREEN;

  return new TwoPointGestureProcessor({
    interpret: interpretCircleRadius,
    collectOverlay: collectCircleRadiusOverlay,
    resolveFallbackPatch: ({ anchor, current, count, zoom }) => {
      if (count > 2) return null;
      if (current.sub(anchor).length() >= minDragDistanceScreen / zoom) {
        return null;
      }
      return { data: { radius: fixedRadiusScreen / zoom } };
    },
  });
}

export { interpretCircleRadius, createCircleRadiusProcessor };
