/**
 * @file 圆形创建工具
 * @description 提供单手势圆对象创建器工具实现。
 * @module core/ui-thread/devices-dag/tools/creator/circle-creator
 * @author Zhou Chenyu
 */

import { DEFAULT_CIRCLE_PROPERTY } from "../../../../engine/objects/graph/circle.js";
import { SingleGestureObjectCreatorTool } from "./object-creator.js";
import { Vector } from "../../../../engine/utils/math.js";

const DEFAULT_FIXED_RADIUS_SCREEN = 16;
const DEFAULT_MIN_DRAG_DISTANCE_SCREEN = 4;

/**
 * 圆创建工具类
 * @class
 * @extends SingleGestureObjectCreatorTool
 * @description
 * 单手势创建圆对象：
 * - 手势开始点为圆心
 * - 手势结束点决定半径
 * - 若手势位移过小，则按 viewport.zoom 生成固定半径圆
 * @author Zhou Chenyu
 */
class CircleCreatorTool extends SingleGestureObjectCreatorTool {
  /**
   * 当前正在创建圆对象的本地状态
   * @type {import("../../shared/types.js").LightweightObjectEntry & { data: { radius: number } } | null}
   */
  _entry;

  /**
   * overlay 渲染用——手势中的当前世界坐标位置
   * @type {{ x: number, y: number } | null}
   * @private
   */
  _overlayCurrentPosition;

  /**
   * 圆对象的属性
   * @type {Record<string, any>}
   */
  property;

  /**
   * 默认半径（屏幕坐标系）
   * @type {number}
   */
  fixedRadiusScreen;

  /**
   * 最小拖动距离（屏幕坐标系）
   * @type {number}
   */
  minDragDistanceScreen;

  /**
   * @param {{
   *   property?: Partial<typeof DEFAULT_CIRCLE_PROPERTY>,
   *   fixedRadiusScreen?: number,
   *   minDragDistanceScreen?: number,
   * }} [options={}]
   * @constructor
   */
  constructor(options = {}) {
    super(options);
    this.property = {
      ...DEFAULT_CIRCLE_PROPERTY,
      ...(options.property ?? {}),
    };
    this.fixedRadiusScreen =
      options.fixedRadiusScreen ?? DEFAULT_FIXED_RADIUS_SCREEN;
    this.minDragDistanceScreen =
      options.minDragDistanceScreen ?? DEFAULT_MIN_DRAG_DISTANCE_SCREEN;
    this._overlayCurrentPosition = null;
  }

  getCreatedObjectType() {
    return "CircleObject";
  }

  create(p, id) {
    this._entry = {
      id,
      type: "CircleObject",
      position: new Vector(p.x, p.y),
      property: { ...this.property },
      data: { radius: 0 },
    };
  }

  /**
   * 解析新圆对象的初始专属数据
   * @param {Object} interaction - 当前交互上下文
   * @returns {Record<string, any>} 初始圆数据
   * @protected
   */
  resolveCreatedObjectData(interaction) {
    return { radius: 0 };
  }

  /**
   * 将世界坐标转换为对象局部坐标
   * @param {Vector} position
   * @returns {Vector}
   */
  toLocalPoint(position) {
    return position.sub(this._entry.position);
  }

  /**
   * 当前手势的点数
   * @type {number}
   */
  count;

  /**
   * 通过 RPC 设置半径
   * @param {number} radius - 新半径
   * @param {Object} interaction - 当前交互上下文
   */
  setRadius(radius, interaction) {
    if (this._entry) {
      this._entry.data.radius = radius;
    }

    const boardApi =
      interaction?.context?.services?.boardApi ??
      interaction?.context?.acc?.boardApi;
    if (!boardApi || this.objectId == null) {
      return;
    }

    boardApi.modifyObject(this.objectId, {
      data: { radius },
    });
  }

  beginGesture(interaction) {
    this.count = 0;
    this._overlayCurrentPosition = interaction.position ?? null;
    this.setRadius(0, interaction);
  }

  updateGesture(interaction) {
    this.count++;
    this._overlayCurrentPosition = interaction.position ?? null;
    const localPoint = this.toLocalPoint(interaction.position);
    const radius = localPoint.length();
    this.setRadius(radius, interaction);
  }

  completeGesture(interaction) {
    if (interaction.position) {
      this.count++;
      this._overlayCurrentPosition = interaction.position;
      const localPoint = this.toLocalPoint(interaction.position);
      const radius = localPoint.length();
      this.setRadius(radius, interaction);
    }
    const zoom =
      interaction.context?.services?.viewport?.zoom ??
      interaction.context?.acc?.viewport?.zoom ??
      1;
    if (
      this.count <= 2 &&
      (this._entry?.data?.radius ?? 0) < this.minDragDistanceScreen / zoom
    ) {
      this.setRadius(this.fixedRadiusScreen / zoom, interaction);
    }
  }

  /**
   * 根据半径计算局部外接矩形
   * @param {Object} interaction - 当前交互上下文
   * @returns {{ left: number, top: number, width: number, height: number }}
   * @protected
   */
  resolveCreatedObjectBoundingBox(interaction) {
    const radius = this._entry?.data?.radius ?? 0;
    const size = radius * 2;
    return { left: -radius, top: -radius, width: size, height: size };
  }

  /**
   * 收集当前创建圆工具声明的 overlay 条目
   * @param {{
   *   viewport?: import("../../components/orchestration/viewport.js").Viewport,
   *   renderer?: import("../../components/renderer/ui-renderer.js").UiRenderer,
   * }} [overlayContext={}] - overlay 上下文
   * @returns {import("../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    if (!this.isActionActive) return [];

    const { viewport, renderer } = overlayContext;
    const entry = this._entry;
    const currentPosition = this._overlayCurrentPosition;
    if (!entry || !currentPosition || !viewport || !renderer) return [];

    const center = entry.position;
    if (!center || typeof center.x !== "number") return [];

    const result = [
      {
        source: "circle-center",
        type: "point",
        geometry: {
          worldPoint: center,
          radius: 4,
        },
        style: {
          fillStyle: "#33a1ff",
        },
      },
    ];

    const radius = entry.data?.radius ?? 0;
    if (radius > 0) {
      result.push({
        source: "circle-radius",
        type: "path",
        geometry: {
          worldPoints: [center, currentPosition],
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
   * 清理 overlay 临时状态
   * @param {import("../../devices-dag/dag.js").DevicesDAGHandlerContext} [context={}]
   * @protected
   */
  clearOverlayState(context = {}) {
    this._overlayCurrentPosition = null;
  }

  /**
   * 重置创建器运行时状态
   */
  reset() {
    this._entry = null;
    this.objectId = null;
    this.count = 0;
    this._overlayCurrentPosition = null;
  }
}

export { CircleCreatorTool };
