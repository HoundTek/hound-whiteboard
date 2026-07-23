/**
 * @file 拖拽手势处理器
 * @description 提供 modifier 拖拽手势的统一状态机实现（锚点 + 基准位置 + 初始位置回滚）。
 * @module core/ui-thread/devices-dag/tools/modifier/gesture/drag-processor
 * @author Zhou Chenyu
 */

/**
 * 拖拽手势处理器类
 * @class
 * @description
 * modifier 拖拽手势的统一状态机，持有全部手势运行时状态：
 *
 * - `_anchor` — 手势起始光标世界坐标，手势期间固定不动，
 *   从而保持光标与对象之间的相对偏移不变（光标拖哪，对象跟哪）
 * - `_basePositions` — 当前手势开始时各对象的基准位置，供 update 计算位移
 * - `_initialPositions` — 首次手势（或首次 displacement）时各对象的初始位置，
 *   永不覆盖，仅供 cancel 回滚
 *
 * 每次空间更新通过宿主 modifier 的 `applyGesturePatch(obj, patch, interaction)`
 * 编译为 `modifyObject` 补丁并应用，本类不含任何对象类型专属逻辑。
 * @author Zhou Chenyu
 */
class DragGestureProcessor {
  /**
   * 手势锚点（手势起始光标的世界坐标）
   * @type {{ x: number, y: number }|null}
   * @private
   */
  _anchor;

  /**
   * 当前手势开始时各对象的基准位置（供 update 计算位移）
   * @type {Map<number|object, { x: number, y: number }>|null}
   * @private
   */
  _basePositions;

  /**
   * 首次手势（或首次 displacement）时各对象的初始位置（永不覆盖，仅供 cancel 回滚）
   * @type {Map<number|object, { x: number, y: number }>|null}
   * @private
   */
  _initialPositions;

  /**
   * @constructor
   */
  constructor() {
    this._anchor = null;
    this._basePositions = null;
    this._initialPositions = null;
  }

  /**
   * 解析对象在位置缓存中的键
   * @param {import("../object-modifier.js").ObjectModifierTool} modifier - 宿主对象修改工具
   * @param {import("../../../../../engine/types/types.js").LightweightObjectEntry} obj - 对象条目
   * @returns {number|object} 数字 id 或对象引用
   * @private
   */
  _keyOf(modifier, obj) {
    return modifier.resolveObjectId(obj) ?? obj;
  }

  /**
   * 读取对象当前位置并规整为 plain 坐标
   * @param {import("../object-modifier.js").ObjectModifierTool} modifier - 宿主对象修改工具
   * @param {import("../../../../../engine/types/types.js").LightweightObjectEntry} obj - 对象条目
   * @returns {{ x: number, y: number }} 世界坐标
   * @private
   */
  _readPosition(modifier, obj) {
    const position = modifier.resolveModifiedObjectPosition(obj);
    return { x: position?.x ?? 0, y: position?.y ?? 0 };
  }

  /**
   * 记录各对象的初始位置（仅首次记录，永不覆盖）
   * @param {import("../object-modifier.js").ObjectModifierTool} modifier - 宿主对象修改工具
   * @param {import("../../../../../engine/types/types.js").LightweightObjectEntry[]} objects - 活动对象集合
   * @private
   */
  _recordInitialPositions(modifier, objects) {
    if (this._initialPositions) return;
    this._initialPositions = new Map(
      objects.map((obj) => [this._keyOf(modifier, obj), this._readPosition(modifier, obj)]),
    );
  }

  /**
   * 开始一次拖拽手势
   * @description 记录锚点与各对象基准位置；首次手势时同时记录 cancel 回滚用的初始位置。
   * @param {import("../object-modifier.js").ObjectModifierTool} modifier - 宿主对象修改工具
   * @param {Object} interaction - 当前交互上下文
   */
  begin(modifier, interaction) {
    const { objects, position } = interaction;
    this._anchor = { x: position.x, y: position.y };
    // 总是记录当前手势基准位置，供 update 计算位移
    this._basePositions = new Map(
      objects.map((obj) => [this._keyOf(modifier, obj), this._readPosition(modifier, obj)]),
    );
    // 仅在首次手势时记录 cancel 回滚用的初始位置
    this._recordInitialPositions(modifier, objects);
  }

  /**
   * 更新一次拖拽手势
   * @description 以锚点为基准计算位移，逐对象应用位置补丁。
   * @param {import("../object-modifier.js").ObjectModifierTool} modifier - 宿主对象修改工具
   * @param {Object} interaction - 当前交互上下文
   */
  update(modifier, interaction) {
    const { objects, position } = interaction;
    if (!this._anchor || !this._basePositions) return;

    const dx = position.x - this._anchor.x;
    const dy = position.y - this._anchor.y;

    for (const obj of objects) {
      const basePos = this._basePositions.get(this._keyOf(modifier, obj));
      if (!basePos) continue;
      modifier.applyGesturePatch(
        obj,
        { position: { x: basePos.x + dx, y: basePos.y + dy } },
        interaction,
      );
    }
  }

  /**
   * 完成一次拖拽手势
   * @description 清空锚点与基准位置，保留初始位置——end 后的 cancel 仍能回滚。
   * @param {import("../object-modifier.js").ObjectModifierTool} modifier - 宿主对象修改工具
   * @param {Object} interaction - 当前交互上下文
   */
  complete(modifier, interaction) {
    this._anchor = null;
    this._basePositions = null;
  }

  /**
   * 取消当前拖拽手势
   * @description 逐对象回滚到初始位置，随后清空全部手势状态。
   * @param {import("../object-modifier.js").ObjectModifierTool} modifier - 宿主对象修改工具
   * @param {Object} interaction - 当前交互上下文
   */
  cancel(modifier, interaction) {
    if (this._initialPositions) {
      for (const obj of interaction.objects) {
        const initPos = this._initialPositions.get(this._keyOf(modifier, obj));
        if (!initPos) continue;
        modifier.applyGesturePatch(
          obj,
          { position: { x: initPos.x, y: initPos.y } },
          interaction,
        );
      }
    }
    this._anchor = null;
    this._basePositions = null;
    this._initialPositions = null;
  }

  /**
   * 应用一次无状态位移增量
   * @description
   * displacement 无状态通道：initial 未记录则先补记（保证 cancel 可回滚），
   * 逐对象 position 累加位移；最后把各基准位置也平移同样位移。
   * 锚点不动——保持光标-对象偏移不变（offset = anchor - basePos），
   * 若调整锚点，后续 position 更新会重置偏移导致对象瞬移。
   * @param {import("../object-modifier.js").ObjectModifierTool} modifier - 宿主对象修改工具
   * @param {Object} interaction - 当前交互上下文
   */
  displace(modifier, interaction) {
    const { objects, displacement } = interaction;
    if (!displacement) return;

    this._recordInitialPositions(modifier, objects);

    for (const obj of objects) {
      const currentPos = modifier.resolveModifiedObjectPosition(obj);
      if (!currentPos) continue;
      modifier.applyGesturePatch(
        obj,
        {
          position: {
            x: currentPos.x + displacement.x,
            y: currentPos.y + displacement.y,
          },
        },
        interaction,
      );
    }

    if (!this._basePositions) return;
    for (const basePos of this._basePositions.values()) {
      basePos.x += displacement.x;
      basePos.y += displacement.y;
    }
  }

  /**
   * 重置手势运行时状态
   */
  reset() {
    this._anchor = null;
    this._basePositions = null;
    this._initialPositions = null;
  }
}

export { DragGestureProcessor };
