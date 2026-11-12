/**
 * @file 对象路径编译缓存
 * @description 把笔画的点列编译成 Path2D 并按几何版本号复用，避免每帧重新展平整条路径。
 * @module canvas/object-path-cache
 * @author Zhou Chenyu
 */

/**
 * 路径缓存默认字节预算
 * @description 单条按 `points.length × 32` 粗估，与 tile 缓存的预算同一量级。
 * @type {number}
 */
const DEFAULT_PATH_CACHE_BUDGET_BYTES = 16 * 1024 * 1024;

/**
 * 单点估算字节数
 * @type {number}
 */
const BYTES_PER_POINT = 32;

/**
 * 从点列构建 Path2D
 * @param {Array<{ x: number, y: number }>} points - 世界坐标点列
 * @returns {Path2D | null} 编译结果；环境不支持时返回 null
 */
function buildPath2D(points) {
  if (typeof Path2D === "undefined" || points.length === 0) return null;
  try {
    const path = new Path2D();
    path.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      path.lineTo(points[i].x, points[i].y);
    }
    return path;
  } catch {
    return null;
  }
}

/**
 * 路径编译缓存
 * @class
 * @description
 * 以对象引用为键保存 Path2D。命中条件是几何版本号一致：位置、颜色、缩放变化都不重建，
 * 只有几何变化才重建。超出字节预算时按最近最少使用淘汰。
 * @author Zhou Chenyu
 */
class ObjectPathCache {
  /**
   * 缓存条目
   * @type {Map<Object, { version: number, path2D: Path2D, bytes: number }>}
   * @private
   */
  #entries = new Map();

  /**
   * 使用顺序计数
   * @type {number}
   * @private
   */
  #clock = 0;

  /**
   * 字节预算
   * @type {number}
   * @private
   */
  #budgetBytes;

  /**
   * 构建次数
   * @type {number}
   * @private
   */
  #builds = 0;

  /**
   * 回退次数
   * @type {number}
   * @private
   */
  #fallbacks = 0;

  /**
   * 构造缓存
   * @param {{ budgetBytes?: number }} [options={}] - 配置
   */
  constructor(options = {}) {
    this.#budgetBytes = options.budgetBytes ?? DEFAULT_PATH_CACHE_BUDGET_BYTES;
  }

  /**
   * 取对象的编译路径
   * @description 版本一致时直接复用；否则重新编译并做预算淘汰。不支持 Path2D 的环境返回 null。
   * @param {Object} object - 白板对象
   * @returns {Path2D | null} 编译路径
   */
  acquire(object) {
    if (!object) return null;
    const version = object.geometryVersion ?? 0;
    const entry = this.#entries.get(object);
    if (entry && entry.version === version) {
      entry.lastUsed = ++this.#clock;
      return entry.path2D;
    }

    const pathRange = object.getWorldPathRange?.();
    const points = pathRange?.points ?? [];
    const path2D = buildPath2D(points);
    if (!path2D) {
      this.#fallbacks += 1;
      return null;
    }

    const bytes = points.length * BYTES_PER_POINT;
    this.#entries.set(object, { version, path2D, bytes, lastUsed: ++this.#clock });
    this.#builds += 1;
    this.evictToBudget();
    return path2D;
  }

  /**
   * 删除对象的缓存条目
   * @param {Object} object - 白板对象
   * @returns {void}
   */
  invalidate(object) {
    const entry = this.#entries.get(object);
    if (!entry) return;
    this.#entries.delete(object);
  }

  /**
   * 按预算淘汰最近最少使用的条目
   * @returns {number} 淘汰条数
   */
  evictToBudget() {
    let removed = 0;
    while (this.usedBytes > this.#budgetBytes && this.#entries.size > 1) {
      let victim = null;
      let victimClock = Infinity;
      for (const [object, entry] of this.#entries) {
        if (entry.lastUsed < victimClock) {
          victimClock = entry.lastUsed;
          victim = object;
        }
      }
      if (!victim) break;
      this.#entries.delete(victim);
      removed++;
    }
    return removed;
  }

  /**
   * 已占用字节数
   * @type {number}
   */
  get usedBytes() {
    let total = 0;
    for (const entry of this.#entries.values()) total += entry.bytes;
    return total;
  }

  /**
   * 统计信息
   * @returns {{ entries: number, bytes: number, builds: number, fallbacks: number }} 统计
   */
  stats() {
    return {
      entries: this.#entries.size,
      bytes: this.usedBytes,
      builds: this.#builds,
      fallbacks: this.#fallbacks,
    };
  }
}

export { ObjectPathCache, DEFAULT_PATH_CACHE_BUDGET_BYTES };
