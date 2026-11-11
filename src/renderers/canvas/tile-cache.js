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
 * 默认 tile 边长（像素）
 * @description 世界尺寸等于像素尺寸除以缩放档位，档位固定时世界尺寸也固定。
 */
const DEFAULT_TILE_SIZE = 512;

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
   * tile 位图像素相对世界单位的倍率
   * @description
   * 高分屏下 tile 必须按设备像素分配位图，否则合成到高位图输出时会被放大，
   * 描边发虚。tileSize 仍以世界单位表达，位图尺寸 = tileSize × deviceScale。
   * @type {number}
   */
  deviceScale;

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
   * 逐出与世界矩形完全不相交的 tile
   * @description 保留范围应大于常用覆盖范围，避免边界往返时反复分配。
   * @param {RectangleRange | Object} keepWorldRect - 保留的世界矩形
   * @returns {number} 被逐出的 tile 数量
   */
  evictOutside(keepWorldRect) {
    const keepRect = RectangleRange.fromRectLike(keepWorldRect);
    if (!keepRect) return 0;

    let evicted = 0;
    for (const [key, tile] of this.#tiles) {
      if (intersectsRanges(tile.worldRect, keepRect)) continue;
      this.#tiles.delete(key);
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
    return {
      key: this.key(tx, ty),
      tx,
      ty,
      worldX,
      worldY,
      worldRect: new RectangleRange(worldX, worldY, this.tileSize, this.tileSize),
      canvas: this.#createCanvas(this.bitmapSize, this.bitmapSize),
      dirty: true,
      dirtyRects: [],
    };
  }
}

export { TileStore, DEFAULT_TILE_SIZE };
