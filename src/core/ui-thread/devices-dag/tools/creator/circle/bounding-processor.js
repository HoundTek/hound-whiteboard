/**
 * @file 外接矩形手势处理器
 * @description 提供外接矩形（椭圆）手势的 interpret 纯函数与 processor 工厂。
 * @module core/ui-thread/devices-dag/tools/creator/circle/bounding-processor
 * @author Zhou Chenyu
 */

import { Vector } from "../../../../../engine/utils/math.js";
import { TwoPointGestureProcessor } from "../gesture/two-point-processor.js";

const DEFAULT_FIXED_RADIUS_SCREEN = 16;
const DEFAULT_MIN_DRAG_DISTANCE_SCREEN = 4;

/**
 * 单位变换矩阵
 * @type {import("../../../../../engine/types/types.js").TransformMatrix2D}
 */
const IDENTITY_TRANSFORM = Object.freeze({ a: 1, b: 0, c: 0, d: 1 });

/**
 * 外接矩形手势解释函数
 * @description
 * 锚点与当前点为外接矩形对角，椭圆经 transform 表达：
 * data 固定 `{ radius: k }`（k = min(w, h) / 2，即内切圆半径），
 * transform 为 diag(w / 2k, h / 2k)——短轴分量恒为单位，长轴分量 ≥ 1。
 * 零点尺寸时退化为半径 0 的正圆。
 * @param {Vector} anchor - 锚点（外接矩形一角）
 * @param {Vector} current - 当前点（外接矩形对角）
 * @returns {import("../gesture/two-point-processor.js").GesturePatch} 圆心、半径与变换补丁
 */
function interpretCircleBounding(anchor, current) {
  const width = Math.abs(current.x - anchor.x);
  const height = Math.abs(current.y - anchor.y);
  const innerRadius = Math.min(width, height) / 2;
  const center = new Vector((anchor.x + current.x) / 2, (anchor.y + current.y) / 2);

  if (innerRadius <= 0) {
    return {
      position: center,
      data: { radius: 0 },
      transform: { ...IDENTITY_TRANSFORM },
    };
  }

  return {
    position: center,
    data: { radius: innerRadius },
    transform: {
      a: width / (innerRadius * 2),
      b: 0,
      c: 0,
      d: height / (innerRadius * 2),
    },
  };
}

/**
 * 收集外接矩形手势的 overlay 条目
 * @param {Vector} anchor - 锚点（外接矩形一角）
 * @param {Vector} current - 当前点（外接矩形对角）
 * @returns {import("../../../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
 */
function collectCircleBoundingOverlay(anchor, current) {
  if (current.x === anchor.x && current.y === anchor.y) {
    return [];
  }

  return [
    {
      source: "circle-bounding",
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
 * 创建外接矩形（椭圆）手势处理器
 * @param {{
 *   fixedRadiusScreen?: number,
 *   minDragDistanceScreen?: number,
 * }} [options={}] - 点击兜底配置（屏幕坐标系）
 * @returns {TwoPointGestureProcessor} 配置好的两点手势处理器
 */
function createCircleBoundingProcessor(options = {}) {
  const fixedRadiusScreen = options.fixedRadiusScreen ?? DEFAULT_FIXED_RADIUS_SCREEN;
  const minDragDistanceScreen =
    options.minDragDistanceScreen ?? DEFAULT_MIN_DRAG_DISTANCE_SCREEN;

  return new TwoPointGestureProcessor({
    interpret: interpretCircleBounding,
    collectOverlay: collectCircleBoundingOverlay,
    resolveFallbackPatch: ({ anchor, current, count, zoom }) => {
      if (count > 2) return null;
      const width = Math.abs(current.x - anchor.x);
      const height = Math.abs(current.y - anchor.y);
      if (Math.min(width, height) / 2 >= minDragDistanceScreen / zoom) {
        return null;
      }
      return {
        position: anchor,
        data: { radius: fixedRadiusScreen / zoom },
        transform: { ...IDENTITY_TRANSFORM },
      };
    },
  });
}

export { interpretCircleBounding, createCircleBoundingProcessor };
