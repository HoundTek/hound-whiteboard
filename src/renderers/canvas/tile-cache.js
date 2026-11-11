/**
 * @file 世界空间 tile 缓存
 * @description 以固定世界尺寸切分位图缓存，平移只重新合成而不重新光栅化。
 * @module canvas/tile-cache
 * @author Zhou Chenyu
 */

import { intersectsRanges, RectangleRange } from "../../kernel/range/index.js";

/**
 * 单块 tile 允许的局部脏区数量上限
 * @description 超过后记为整块重建，避免大量小区域逐个裁剪重绘反而更贵。
 */
const MAX_TILE_DIRTY_RECTS = 8;

/**
 * 默认 tile 边长（CSS 像素）
 * @description
 * tile 在屏幕空间恒为此尺寸，与缩放和视口无关。
 * 取 256 是为了让缓存面积贴近视口面积：块越大，外扩区与网格取整的浪费越大，
 * 900x700 的视口配 1024 的块时，外扩后要铺 3 列，覆盖面积是视口的 3.4 倍。
 * @type {number}
 */
const DEFAULT_TILE_SIZE = 256;

/**
 * 默认 tile 缓存字节预算
 * @description 超预算按最近最少使用逐出。多层缓存的总额度由调用方统一控制。
 * @type {number}
 */
const DEFAULT_TILE_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * 单块 tile 记录
 * @typedef {Object} TileEntry
 * @property {string} key - tile 键
 * @property {number} tx - 横向 tile 序号
 * @property {number} ty - 纵向 tile 序号
 * @property {number} worldX - 世界左边界
 * @property {number} worldY - 世界上边界
 * @property {RectangleRange} worldRect - 世界范围
 * @property {OffscreenCanvas | HTMLCanvasElement} canvas - 位图画布
 * @property {boolean} dirty - 是否需要整块重新光栅化
 * @property {RectangleRange[]} dirtyRects - 需要局部重绘的世界矩形
 */

/**
 * 世界空间 tile 存储
 * @description
 * 只负责 tile 的键值、覆盖范围、失效标记与逐出，不做任何绘制。
 * tile 按世界坐标对齐，与视口位置无关，因此平移不会改变 tile 内容，
 * 只有内容变化（对象提交、擦除、区块装卸载）才需要标记失效。
 * 新建 tile 一律为脏，由调用方决定何时重建。
 *
 * @class
 */
class TileStore {
  /**
   * tile 边长（像素）
   * @type {number}
   */
  tileSize;

  /**
   * tile 画布工厂
   * @type {(width: number, height: number) => OffscreenCanvas | HTMLCanvasElement}
   * @private
   */
  #createCanvas;

  /**
   * 已分配字节数
   * @type {number}
   * @private
   */
  #usedBytes = 0;

  /**
   * tile 位图像素相对世界单位的倍率
   * @description
   * 高分屏下 tile 必须按设备像素分配位图，否则合成到高位图输出时会被放大，
   * 描边发虚。tileSize 仍以世界单位表达，位图尺寸 = tileSize × deviceScale。
   * @type {number}
   */
  deviceScale;

  /**
   * tile 缓存字节预算
   * @description 实际占用超过预算时按最近最少使用逐出 tile。
   * @type {number}
   */
  maxBytes;

  /**
   * 已分配的 tile
   * @type {Map<string, TileEntry>}
   * @private
   */
  #tiles = new Map();

  /**
   * 累计重建次数
   * @description 由外部在重建后调用 markRebuilt 累加，用于验证平移是否零重绘。
   * @type {number}
   */
  rebuildCount = 0;

  /**
   * @param {{ tileSize?: number, deviceScale?: number, createCanvas?: (width: number, height: number) => OffscreenCanvas | HTMLCanvasElement }} [options={}] - 配置项
   */
  constructor(options = {}) {
    this.tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
    const scale = options.deviceScale;
    this.deviceScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    this.#createCanvas =
      options.createCanvas ?? ((width, height) => new OffscreenCanvas(width, height));
    this.maxBytes = options.maxBytes ?? DEFAULT_TILE_BUDGET_BYTES;
  }

  /**
   * 当前已分配的字节数
   * @description 按位图边长与每像素 4 字节计，是缓存内存的真实占用。
   * @type {number}
   */
  get usedBytes() {
    return this.#usedBytes;
  }

  /**
   * 单块 tile 的位图边长（设备像素）
   * @type {number}
   */
  get bitmapSize() {
    return Math.max(1, Math.round(this.tileSize * this.deviceScale));
  }

  /**
   * 已分配的 tile 数量
   * @type {number}
   */
  get size() {
    return this.#tiles.size;
  }

  /**
   * 计算 tile 键
   * @param {number} tx - 横向 tile 序号
   * @param {number} ty - 纵向 tile 序号
   * @returns {string}
   */
  key(tx, ty) {
    return `${tx},${ty}`;
  }

  /**
   * 计算覆盖世界矩形所需的 tile 序号范围
   * @param {RectangleRange | Object} rect - 世界矩形
   * @returns {{ minTx: number, minTy: number, maxTx: number, maxTy: number } | undefined}
   */
  rangeForWorldRect(rect) {
    const normalized = RectangleRange.fromRectLike(rect);
    if (!normalized) return undefined;

    // 右边界用 ceil 减一：减去固定 epsilon 在大坐标下会被浮点精度吞掉，
    // 恰好落在分界线上的右边界不应多算一块 tile
    return {
      minTx: Math.floor(normalized.left / this.tileSize),
      minTy: Math.floor(normalized.top / this.tileSize),
      maxTx: Math.ceil(normalized.right / this.tileSize) - 1,
      maxTy: Math.ceil(normalized.bottom / this.tileSize) - 1,
    };
  }

  /**
   * 确保世界矩形被 tile 覆盖，返回这些 tile
   * @description 缺失的 tile 会被创建并标记为脏，已存在的 tile 保持原失效状态。
   * @param {RectangleRange | Object} worldRect - 需要覆盖的世界矩形
   * @returns {TileEntry[]}
   */
  ensure(worldRect) {
    const range = this.rangeForWorldRect(worldRect);
    if (!range) return [];

    const result = [];
    for (let ty = range.minTy; ty <= range.maxTy; ty++) {
      for (let tx = range.minTx; tx <= range.maxTx; tx++) {
        const key = this.key(tx, ty);
        let tile = this.#tiles.get(key);
        if (!tile) {
          tile = this.#createTile(tx, ty);
          this.#tiles.set(key, tile);
          this.#usedBytes += tile.bytes;
        } else {
          this.touch(tile);
        }
        result.push(tile);
      }
    }
    return result;
  }

  /**
   * 把内容变化的世界矩形记为相关 tile 的局部脏区
   * @description
   * 局部脏区让提交只重绘 tile 内的一小块，而不是整幅 512×512。
   * 尚未创建的 tile 无需标记，创建时即为整块脏。
   * 单块 tile 的脏区数量超过上限时退化为整块重建。
   * @param {RectangleRange | Object} worldRect - 内容发生变化的世界矩形
   * @returns {number} 被标记的 tile 数量
   */
  markDirtyWorldRect(worldRect) {
    const rect = RectangleRange.fromRectLike(worldRect);
    if (!rect) return 0;

    const range = this.rangeForWorldRect(rect);
    let marked = 0;
    for (let ty = range.minTy; ty <= range.maxTy; ty++) {
      for (let tx = range.minTx; tx <= range.maxTx; tx++) {
        const tile = this.#tiles.get(this.key(tx, ty));
        if (!tile || tile.dirty) continue;
        tile.dirtyRects.push(rect);
        if (tile.dirtyRects.length > MAX_TILE_DIRTY_RECTS) {
          tile.dirty = true;
          tile.dirtyRects.length = 0;
        }
        marked++;
      }
    }
    return marked;
  }

  /**
   * 标记所有 tile 为脏
   * @returns {number} 被标记的 tile 数量
   */
  markAllDirty() {
    let marked = 0;
    for (const tile of this.#tiles.values()) {
      if (tile.dirty) continue;
      tile.dirty = true;
      tile.dirtyRects.length = 0;
      marked++;
    }
    return marked;
  }

  /**
   * 判断 tile 是否需要重绘
   * @param {TileEntry} tile - 目标 tile
   * @returns {boolean} 整块脏或存在局部脏区
   */
  isDirty(tile) {
    return tile.dirty || tile.dirtyRects.length > 0;
  }

  /**
   * 标记 tile 为最近使用
   * @description Map 按插入顺序迭代，删后重插即可把它移到队尾。
   * @param {TileEntry} tile - 被访问的 tile
   */
  touch(tile) {
    if (!tile) return;
    this.#tiles.delete(tile.key);
    this.#tiles.set(tile.key, tile);
  }

  /**
   * 按字节预算逐出最近最少使用的 tile
   * @description
   * 只按最近使用时间逐出，不按屏幕位置：多档缩放共用一个预算时，
   * 空间规则会把刚离开但马上要回来的档位扔掉。
   * @returns {number} 被逐出的 tile 数量
   */
  evictToBudget() {
    let evicted = 0;
    for (const [key, tile] of this.#tiles) {
      if (this.#usedBytes <= this.maxBytes) break;
      this.#tiles.delete(key);
      this.#usedBytes -= tile.bytes;
      evicted++;
    }
    return evicted;
  }

  /**
   * 记录一次 tile 重建并清除脏标记
   * @param {TileEntry} tile - 已重建的 tile
   */
  markRebuilt(tile) {
    tile.dirty = false;
    tile.dirtyRects.length = 0;
    this.rebuildCount++;
  }

  /**
   * 统计当前脏 tile 数量
   * @returns {number}
   */
  countDirty() {
    let count = 0;
    for (const tile of this.#tiles.values()) {
      if (this.isDirty(tile)) count++;
    }
    return count;
  }

  /**
   * 清空全部 tile
   */
  clear() {
    this.#tiles.clear();
    this.#usedBytes = 0;
  }

  /**
   * 创建单块 tile
   * @param {number} tx - 横向 tile 序号
   * @param {number} ty - 纵向 tile 序号
   * @returns {TileEntry}
   * @private
   */
  #createTile(tx, ty) {
    const worldX = tx * this.tileSize;
    const worldY = ty * this.tileSize;
    const bitmapSize = this.bitmapSize;
    return {
      key: this.key(tx, ty),
      tx,
      ty,
      worldX,
      worldY,
      worldRect: new RectangleRange(worldX, worldY, this.tileSize, this.tileSize),
      canvas: this.#createCanvas(bitmapSize, bitmapSize),
      bytes: bitmapSize * bitmapSize * 4,
      dirty: true,
      dirtyRects: [],
    };
  }
}

export { TileStore, DEFAULT_TILE_SIZE, DEFAULT_TILE_BUDGET_BYTES };
