/**
 * @file 椭圆数据创建工具
 * @description 提供椭圆对象的数据创建器实现，手势解释由组合的 processor 承担。
 * @module core/ui-thread/devices-dag/tools/creator/ellipse/data-creator
 * @author Zhou Chenyu
 */

import { DEFAULT_ELLIPSE_PROPERTY } from "../../../../../engine/objects/graph/ellipse.js";
import { SingleGestureObjectCreatorTool } from "../object-creator.js";
import { Vector } from "../../../../../engine/utils/math.js";

/**
 * 椭圆数据创建工具类
 * @class
 * @extends SingleGestureObjectCreatorTool
 * @description
 * 椭圆对象的数据侧创建器：负责草稿初始化、RPC 创建/提交、外接矩形解析，
 * 不含任何手势解释逻辑。手势由必传的 processor 策略对象承担
 * （当前为外接矩形手势，见同目录 bounding-processor.js），
 * 四个手势钩子与 overlay 收集全部委托给它。
 *
 * 椭圆数据直接存双轴半径 `{ radiusX, radiusY }`，position 为椭圆中心。
 * @author Zhou Chenyu
 */
class EllipseDataCreatorTool extends SingleGestureObjectCreatorTool {
  /**
   * 当前正在创建椭圆对象的本地状态
   * @type {import("../../../../../engine/types/types.js").LightweightObjectEntry & { data: { radiusX: number, radiusY: number } } | null}
   */
  _entry;

  /**
   * 椭圆对象的属性
   * @type {Record<string, any>}
   */
  property;

  /**
   * 手势处理器（策略对象，负责把 position 流编译为数据补丁）
   * @type {import("../gesture/two-point-processor.js").TwoPointGestureProcessor}
   */
  processor;

  /**
   * @param {{
   *   property?: Partial<typeof DEFAULT_ELLIPSE_PROPERTY>,
   *   processor: import("../gesture/two-point-processor.js").TwoPointGestureProcessor,
   * }} options - 配置选项（processor 必传）
   * @constructor
   */
  constructor(options) {
    super(options);
    if (!options?.processor) {
      throw new Error(
        "EllipseDataCreatorTool requires an explicit `processor` option.",
      );
    }
    this.property = {
      ...DEFAULT_ELLIPSE_PROPERTY,
      ...(options.property ?? {}),
    };
    this.processor = options.processor;
  }

  getCreatedObjectType() {
    return "EllipseObject";
  }

  create(p, id) {
    this._entry = {
      id,
      type: "EllipseObject",
      position: new Vector(p.x, p.y),
      property: { ...this.property },
      data: { radiusX: 0, radiusY: 0 },
    };
  }

  /**
   * 解析新椭圆对象的初始专属数据
   * @param {Object} interaction - 当前交互上下文
   * @returns {Record<string, any>} 初始椭圆数据
   * @protected
   */
  resolveCreatedObjectData(interaction) {
    return { radiusX: 0, radiusY: 0 };
  }

  /**
   * 开始一次创建手势（委托给 processor）
   * @param {Object} interaction - 当前交互上下文
   */
  beginGesture(interaction) {
    this.processor.begin(this, interaction);
  }

  /**
   * 更新一次创建手势（委托给 processor）
   * @param {Object} interaction - 当前交互上下文
   */
  updateGesture(interaction) {
    this.processor.update(this, interaction);
  }

  /**
   * 完成一次创建手势（委托给 processor）
   * @param {Object} interaction - 当前交互上下文
   */
  completeGesture(interaction) {
    this.processor.complete(this, interaction);
  }

  /**
   * 取消当前创建手势（委托给 processor）
   * @param {Object} interaction - 当前交互上下文
   */
  cancelGesture(interaction) {
    this.processor.cancel(this, interaction);
  }

  /**
   * 根据双轴半径与 transform 计算局部外接矩形
   * @description rx' = radiusX·hypot(a, b)，ry' = radiusY·hypot(c, d)；无 transform 时退化为轴对齐椭圆。
   * @param {Object} interaction - 当前交互上下文
   * @returns {{ left: number, top: number, width: number, height: number }}
   * @protected
   */
  resolveCreatedObjectBoundingBox(interaction) {
    const radiusX = this._entry?.data?.radiusX ?? 0;
    const radiusY = this._entry?.data?.radiusY ?? 0;
    const transform = this._entry?.transform;
    const scaledRadiusX = transform
      ? radiusX * Math.hypot(transform.a, transform.b)
      : radiusX;
    const scaledRadiusY = transform
      ? radiusY * Math.hypot(transform.c, transform.d)
      : radiusY;
    return {
      left: -scaledRadiusX,
      top: -scaledRadiusY,
      width: scaledRadiusX * 2,
      height: scaledRadiusY * 2,
    };
  }

  /**
   * 收集当前创建椭圆工具声明的 overlay 条目（委托给 processor）
   * @param {Object} [overlayContext={}] - overlay 上下文
   * @returns {import("../../../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    if (!this.isActionActive) return [];
    return this.processor.collectUiOverlayEntries(this, overlayContext);
  }

  /**
   * 清理 overlay 临时状态
   * @description 手势状态的生命周期与动作一致，动作结束时整体重置 processor。
   * @param {import("../../../dag-type.js").DevicesDAGHandlerContext} [context={}]
   * @protected
   */
  clearOverlayState(context = {}) {
    this.processor.reset();
  }

  /**
   * 重置创建器运行时状态
   */
  reset() {
    this._entry = null;
    this.objectId = null;
    this.processor.reset();
  }
}

export { EllipseDataCreatorTool };
