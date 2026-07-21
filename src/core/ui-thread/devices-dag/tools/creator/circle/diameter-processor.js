/**
 * @file 直径手势处理器
 * @description 提供直径手势的 interpret 纯函数与 processor 工厂。
 * @module core/ui-thread/devices-dag/tools/creator/circle/diameter-processor
 * @author Zhou Chenyu
 */

import { Vector } from "../../../../../engine/utils/math.js";
import { TwoPointGestureProcessor } from "../gesture/two-point-processor.js";

const DEFAULT_FIXED_RADIUS_SCREEN = 16;
const DEFAULT_MIN_DRAG_DISTANCE_SCREEN = 4;

/**
 * 直径手势解释函数
 * @description 锚点与当前点为直径两端，圆心取中点，半径取距离的一半。
 * @param {Vector} anchor - 锚点（直径一端）
 * @param {Vector} current - 当前点（直径另一端）
 * @returns {import("../gesture/two-point-processor.js").GesturePatch} 圆心与半径补丁
 */
function interpretCircleDiameter(anchor, current) {
  return {
    position: new Vector((anchor.x + current.x) / 2, (anchor.y + current.y) / 2),
    data: { radius: current.sub(anchor).length() / 2 },
  };
}

/**
 * 收集直径手势的 overlay 条目
 * @param {Vector} anchor - 锚点（直径一端）
 * @param {Vector} current - 当前点（直径另一端）
 * @returns {import("../../../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
 */
function collectCircleDiameterOverlay(anchor, current) {
  const result = [];

  if (current.sub(anchor).length() > 0) {
    result.push({
      source: "circle-diameter",
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

  result.push({
    source: "circle-center",
    type: "point",
    geometry: {
      worldPoint: new Vector((anchor.x + current.x) / 2, (anchor.y + current.y) / 2),
      radius: 4,
    },
    style: {
      fillStyle: "#33a1ff",
    },
  });

  return result;
}

/**
 * 创建直径手势处理器
 * @param {{
 *   fixedRadiusScreen?: number,
 *   minDragDistanceScreen?: number,
 * }} [options={}] - 点击兜底配置（屏幕坐标系）
 * @returns {TwoPointGestureProcessor} 配置好的两点手势处理器
 */
function createCircleDiameterProcessor(options = {}) {
  const fixedRadiusScreen = options.fixedRadiusScreen ?? DEFAULT_FIXED_RADIUS_SCREEN;
  const minDragDistanceScreen =
    options.minDragDistanceScreen ?? DEFAULT_MIN_DRAG_DISTANCE_SCREEN;

  return new TwoPointGestureProcessor({
    interpret: interpretCircleDiameter,
    collectOverlay: collectCircleDiameterOverlay,
    resolveFallbackPatch: ({ anchor, current, count, zoom }) => {
      if (count > 2) return null;
      if (current.sub(anchor).length() >= minDragDistanceScreen / zoom) {
        return null;
      }
      return { data: { radius: fixedRadiusScreen / zoom } };
    },
  });
}

export { interpretCircleDiameter, createCircleDiameterProcessor };
