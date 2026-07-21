/**
 * @file 圆形数据创建工具
 * @description 提供圆对象的数据创建器实现，手势解释由组合的 processor 承担。
 * @module core/ui-thread/devices-dag/tools/creator/circle/data-creator
 * @author Zhou Chenyu
 */

import { DEFAULT_CIRCLE_PROPERTY } from "../../../../../engine/objects/graph/circle.js";
import { SingleGestureObjectCreatorTool } from "../object-creator.js";
import { Vector } from "../../../../../engine/utils/math.js";

/**
 * 圆形数据创建工具类
 * @class
 * @extends SingleGestureObjectCreatorTool
 * @description
 * 圆对象的数据侧创建器：负责草稿初始化、RPC 创建/提交、外接矩形解析，
 * 不含任何手势解释逻辑。手势由必传的 processor 策略对象承担
 * （圆心+半径 / 直径 / 外接矩形，见同目录 processor 文件），
 * 四个手势钩子与 overlay 收集全部委托给它。
 *
 * 椭圆通过 transform 表达：data 固定 `{ radius: k }`（k 为内切圆半径），
 * 形状由 transform 的非均匀缩放承担，短轴分量恒为单位。
 * @author Zhou Chenyu
 */
class CircleDataCreatorTool extends SingleGestureObjectCreatorTool {
  /**
   * 当前正在创建圆对象的本地状态
   * @type {import("../../../../../engine/types/types.js").LightweightObjectEntry & { data: { radius: number } } | null}
   */
  _entry;

  /**
   * 圆对象的属性
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
   *   property?: Partial<typeof DEFAULT_CIRCLE_PROPERTY>,
   *   processor: import("../gesture/two-point-processor.js").TwoPointGestureProcessor,
   * }} options - 配置选项（processor 必传）
   * @constructor
   */
  constructor(options) {
    super(options);
    if (!options?.processor) {
      throw new Error(
        "CircleDataCreatorTool requires an explicit `processor` option.",
      );
    }
    this.property = {
      ...DEFAULT_CIRCLE_PROPERTY,
      ...(options.property ?? {}),
    };
    this.processor = options.processor;
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
   * 根据半径与 transform 计算局部外接矩形
   * @description rx = r·hypot(a, b)，ry = r·hypot(c, d)；无 transform 时退化为正圆。
   * @param {Object} interaction - 当前交互上下文
   * @returns {{ left: number, top: number, width: number, height: number }}
   * @protected
   */
  resolveCreatedObjectBoundingBox(interaction) {
    const radius = this._entry?.data?.radius ?? 0;
    const transform = this._entry?.transform;
    const radiusX = transform
      ? radius * Math.hypot(transform.a, transform.b)
      : radius;
    const radiusY = transform
      ? radius * Math.hypot(transform.c, transform.d)
      : radius;
    return {
      left: -radiusX,
      top: -radiusY,
      width: radiusX * 2,
      height: radiusY * 2,
    };
  }

  /**
   * 收集当前创建圆工具声明的 overlay 条目（委托给 processor）
   * @param {Object} [overlayContext={}] - overlay 上下文
   * @returns {import("../../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectUiOverlayEntries(overlayContext = {}) {
    if (!this.isActionActive) return [];
    return this.processor.collectUiOverlayEntries(this, overlayContext);
  }

  /**
   * 清理 overlay 临时状态
   * @description 手势状态的生命周期与动作一致，动作结束时整体重置 processor。
   * @param {import("../../../devices-dag/dag-type.js").DevicesDAGHandlerContext} [context={}]
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

export { CircleDataCreatorTool };
