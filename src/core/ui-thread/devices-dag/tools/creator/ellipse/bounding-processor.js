/**
 * @file 外接矩形手势处理器
 * @description 提供椭圆外接矩形手势的 interpret 纯函数与 processor 工厂。
 * @module core/ui-thread/devices-dag/tools/creator/ellipse/bounding-processor
 * @author Zhou Chenyu
 */

import { Vector } from "../../../../../engine/utils/math.js";
import { TwoPointGestureProcessor } from "../gesture/two-point-processor.js";

const DEFAULT_FIXED_RADIUS_SCREEN = 16;
const DEFAULT_MIN_DRAG_DISTANCE_SCREEN = 4;

/**
 * 外接矩形手势解释函数
 * @description 锚点与当前点为外接矩形对角，椭圆中心取矩形中心，
 * 双轴半径各取矩形宽高的一半。
 * @param {Vector} anchor - 锚点（外接矩形一角）
 * @param {Vector} current - 当前点（外接矩形对角）
 * @returns {import("../gesture/two-point-processor.js").GesturePatch} 中心与双轴半径补丁
 */
function interpretEllipseBounding(anchor, current) {
  return {
    position: new Vector((anchor.x + current.x) / 2, (anchor.y + current.y) / 2),
    data: {
      radiusX: Math.abs(current.x - anchor.x) / 2,
      radiusY: Math.abs(current.y - anchor.y) / 2,
    },
  };
}

/**
 * 收集外接矩形手势的 overlay 条目
 * @param {Vector} anchor - 锚点（外接矩形一角）
 * @param {Vector} current - 当前点（外接矩形对角）
 * @returns {import("../../../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
 */
function collectEllipseBoundingOverlay(anchor, current) {
  if (current.x === anchor.x && current.y === anchor.y) {
    return [];
  }

  return [
    {
      source: "ellipse-bounding",
      type: "path",
      geometry: {
        worldPoints: [
          anchor,
          new Vector(current.x, anchor.y),
          current,
          new Vector(anchor.x, current.y),
        ],
        closePath: true,
      },
      style: {
        strokeStyle: "#33a1ff",
        lineWidth: 1,
        lineDash: [4, 4],
      },
    },
  ];
}

/**
 * 创建外接矩形手势处理器
 * @param {{
 *   fixedRadiusScreen?: number,
 *   minDragDistanceScreen?: number,
 * }} [options={}] - 点击兜底配置（屏幕坐标系）
 * @returns {TwoPointGestureProcessor} 配置好的两点手势处理器
 */
function createEllipseBoundingProcessor(options = {}) {
  const fixedRadiusScreen = options.fixedRadiusScreen ?? DEFAULT_FIXED_RADIUS_SCREEN;
  const minDragDistanceScreen =
    options.minDragDistanceScreen ?? DEFAULT_MIN_DRAG_DISTANCE_SCREEN;

  return new TwoPointGestureProcessor({
    interpret: interpretEllipseBounding,
    collectOverlay: collectEllipseBoundingOverlay,
    resolveFallbackPatch: ({ anchor, current, count, zoom }) => {
      if (count > 2) return null;
      const radiusX = Math.abs(current.x - anchor.x) / 2;
      const radiusY = Math.abs(current.y - anchor.y) / 2;
      if (
        radiusX >= minDragDistanceScreen / zoom &&
        radiusY >= minDragDistanceScreen / zoom
      ) {
        return null;
      }
      return {
        position: anchor,
        data: {
          radiusX: fixedRadiusScreen / zoom,
          radiusY: fixedRadiusScreen / zoom,
        },
      };
    },
  });
}

export { interpretEllipseBounding, createEllipseBoundingProcessor };
