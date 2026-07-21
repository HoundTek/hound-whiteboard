/**
 * @file 两点手势处理器
 * @description 提供锚点+当前点两点手势族的统一状态机实现。
 * @module core/ui-thread/devices-dag/tools/creator/gesture/two-point-processor
 * @author Zhou Chenyu
 */

/**
 * 两点手势补丁
 * @description 形状与 `boardApi.modifyObject(objectId, patch)` 的补丁契约一致。
 * @typedef {Object} GesturePatch
 * @property {import("../../../../../engine/utils/math.js").Vector|import("../../../../../engine/types/types.js").Point2D} [position] - 对象世界坐标位置
 * @property {Record<string, any>} [data] - 类型专属几何数据补丁
 * @property {import("../../../../../engine/types/types.js").TransformMatrix2D} [transform] - 对象变换矩阵补丁
 */

/**
 * 两点手势解释函数
 * @description 将锚点与当前点映射为对象补丁，必须为纯函数。
 * @typedef {(anchor: import("../../../../../engine/utils/math.js").Vector, current: import("../../../../../engine/utils/math.js").Vector) => GesturePatch} TwoPointInterpret
 */

/**
 * 两点手势 overlay 收集函数
 * @typedef {(anchor: import("../../../../../engine/utils/math.js").Vector, current: import("../../../../../engine/utils/math.js").Vector) => import("../../../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]} TwoPointCollectOverlay
 */

/**
 * 两点手势兜底补丁解析函数
 * @description 在手势完成时调用，返回 null 表示无需兜底。
 * @typedef {(params: { anchor: import("../../../../../engine/utils/math.js").Vector, current: import("../../../../../engine/utils/math.js").Vector, count: number, zoom: number }) => GesturePatch|null} TwoPointResolveFallbackPatch
 */

/**
 * 两点手势处理器类
 * @class
 * @description
 * 两点手势族（圆心+半径、直径、外接矩形等）的统一状态机：
 * 手势开始点记为锚点，手势过程中的最近位置记为当前点，
 * 每次空间更新通过 `interpret(anchor, current)` 纯函数编译为
 * `modifyObject` 补丁并应用到宿主 creator。
 *
 * 手势与数据的差异全部下沉到构造配置（interpret / collectOverlay /
 * resolveFallbackPatch），本类不含任何形状专属逻辑。
 * @author Zhou Chenyu
 */
class TwoPointGestureProcessor {
  /**
   * 锚点（手势开始时的世界坐标）
   * @type {import("../../../../../engine/utils/math.js").Vector|null}
   * @private
   */
  _anchor;

  /**
   * 当前点（最近一次手势位置的世界坐标）
   * @type {import("../../../../../engine/utils/math.js").Vector|null}
   * @private
   */
  _current;

  /**
   * 当前手势的点数（用于区分点击与拖拽）
   * @description begin 置 0，每次 update 加 1，complete 携带 position 再加 1。
   * @type {number}
   * @private
   */
  _count;

  /**
   * 手势解释函数
   * @type {TwoPointInterpret}
   * @private
   */
  _interpret;

  /**
   * overlay 收集函数
   * @type {TwoPointCollectOverlay}
   * @private
   */
  _collectOverlay;

  /**
   * 兜底补丁解析函数
   * @type {TwoPointResolveFallbackPatch|undefined}
   * @private
   */
  _resolveFallbackPatch;

  /**
   * @param {{
   *   interpret: TwoPointInterpret,
   *   collectOverlay: TwoPointCollectOverlay,
   *   resolveFallbackPatch?: TwoPointResolveFallbackPatch,
   * }} config - 手势配置（均为纯函数）
   * @constructor
   */
  constructor(config) {
    this._interpret = config.interpret;
    this._collectOverlay = config.collectOverlay;
    this._resolveFallbackPatch = config.resolveFallbackPatch;
    this._anchor = null;
    this._current = null;
    this._count = 0;
  }

  /**
   * 将 interpret 结果编译为补丁并应用到宿主 creator
   * @param {import("../object-creator.js").ObjectCreatorTool} creator - 宿主数据创建器
   * @param {Object} interaction - 当前交互上下文
   * @private
   */
  _apply(creator, interaction) {
    const patch = this._interpret(this._anchor, this._current);
    if (!patch) {
      return;
    }
    creator.applyGesturePatch(patch, interaction);
    creator.afterGeometryMutation(interaction);
  }

  /**
   * 开始一次两点手势
   * @param {import("../object-creator.js").ObjectCreatorTool} creator - 宿主数据创建器
   * @param {Object} interaction - 当前交互上下文
   */
  begin(creator, interaction) {
    this._anchor = interaction.position;
    this._current = interaction.position;
    this._count = 0;
    this._apply(creator, interaction);
  }

  /**
   * 更新一次两点手势
   * @param {import("../object-creator.js").ObjectCreatorTool} creator - 宿主数据创建器
   * @param {Object} interaction - 当前交互上下文
   */
  update(creator, interaction) {
    this._count++;
    this._current = interaction.position;
    this._apply(creator, interaction);
  }

  /**
   * 完成一次两点手势
   * @description 携带 position 时先按终态应用一次补丁，随后解析兜底补丁
   * （如点击未拖动时生成固定尺寸对象）。兜底补丁不再触发 overlay 刷新——
   * overlay 已随动作完成进入清理流程。
   * @param {import("../object-creator.js").ObjectCreatorTool} creator - 宿主数据创建器
   * @param {Object} interaction - 当前交互上下文
   */
  complete(creator, interaction) {
    if (interaction.position) {
      this._count++;
      this._current = interaction.position;
      this._apply(creator, interaction);
    }

    if (typeof this._resolveFallbackPatch !== "function" || !this._anchor) {
      return;
    }

    const zoom = interaction.context?.services?.viewport?.zoom ?? 1;
    const fallbackPatch = this._resolveFallbackPatch({
      anchor: this._anchor,
      current: this._current,
      count: this._count,
      zoom,
    });
    if (fallbackPatch) {
      creator.applyGesturePatch(fallbackPatch, interaction);
    }
  }

  /**
   * 取消当前两点手势
   * @param {import("../object-creator.js").ObjectCreatorTool} creator - 宿主数据创建器
   * @param {Object} interaction - 当前交互上下文
   */
  cancel(creator, interaction) {
    return undefined;
  }

  /**
   * 收集当前手势声明的 overlay 条目
   * @param {import("../object-creator.js").ObjectCreatorTool} creator - 宿主数据创建器
   * @param {Object} [overlayContext={}] - overlay 上下文
   * @returns {import("../../../../components/renderer/ui-overlay-factory.js").UiOverlayEntry[]}
   */
  collectUiOverlayEntries(creator, overlayContext = {}) {
    if (!this._anchor || !this._current) {
      return [];
    }
    return this._collectOverlay(this._anchor, this._current) ?? [];
  }

  /**
   * 重置手势运行时状态
   */
  reset() {
    this._anchor = null;
    this._current = null;
    this._count = 0;
  }
}

export { TwoPointGestureProcessor };
