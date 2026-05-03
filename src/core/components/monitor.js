/**
 * @file 显示器组件
 * @module core/components/monitor
 * @author Zhou Chenyu
 */

import { Device } from "../devices/device.js";
import { Board } from "../components/board.js";
import { PageLoader } from "./page-loader.js";
import { CounterPool } from "../utils/counter-pool.js";
import { Vector } from "../../utils/math.js";

/**
 * 显示器组件
 *
 * @class
 * @author Zhou Chenyu
 */
class Monitor {
  /**
   * 显示器组件的画布
   * @type {HTMLCanvasElement}
   * @todo 现在还没有转移到 React，所以用原生 html。
   */
  canvas;

  /**
   * 白板，用于查询页顺序与页面尺寸
   * @type {Board}
   */
  board;

  /**
   * 页加载器，用于按需加载页面内容
   * @type {PageLoader}
   */
  pageLoader;

  /**
   * canvas 左上角对应的世界坐标（可为负数）
   * @description 翻页、平移、缩放后需整体更新此字段。
   * 初始值使第一页在 canvas 中居中：
   *   origin.x = pageWidth/2 - canvasWidth/(2×zoom)
   *   origin.y = pageHeight/2 - canvasHeight/(2×zoom)
   * @type {Vector}
   */
  origin;

  /**
   * 缩放因子
   * @description 1.0 = 默认比例，>1 = 放大，<1 = 缩小。
   * @type {number}
   */
  zoom;

  /**
   * @param {HTMLCanvasElement} canvas - 画布元素
   * @param {Board} board - 白板管理器
   * @param {{ width: number, height: number }} options - 画布尺寸选项
   */
  constructor(canvas, board, { width, height }) {
    this.canvas = canvas;
    this.board = board;
    this.pageLoader = new PageLoader();
    this.zoom = 1;
    const rect = canvas?.getBoundingClientRect();
    const canvasWidth = rect?.width ?? 0;
    const canvasHeight = rect?.height ?? 0;
    // 初始 origin 使第一页居中显示。若 canvas 尚未布局，调用方应在布局后重新计算
    this.origin = new Vector(
      this.pageWidth / 2 - canvasWidth / (2 * this.zoom),
      this.pageHeight / 2 - canvasHeight / (2 * this.zoom),
    );
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.id = "canvas";
  }

  /**
   * 当前页宽（取自 board）
   * @type {number}
   */
  get pageWidth() {
    return this.board?.width ?? 0;
  }

  /**
   * 当前页高（取自 board）
   * @type {number}
   */
  get pageHeight() {
    return this.board?.height ?? 0;
  }

  /**
   * 将屏幕坐标映射到页空间坐标
   *
   * @description
   * 由 Monitor 提供给 DeviceContext，封装了 origin、zoom 与页面尺寸。
   * 页横向排列、无页间空隙；触点超出所有页的纵向范围时返回 null，Signal 管道自动短路。
   *
   * @param {Vector} screenPos - 屏幕坐标（clientX/clientY）
   * @returns {{ pageId: number, x: number, y: number } | null}
   */
  screenToPage(screenPos) {
    if (!this.canvas || !this.board) return null;

    const rect = this.canvas.getBoundingClientRect();

    // 屏幕坐标 → 画布本地坐标
    const canvasX = screenPos.x - rect.left;
    const canvasY = screenPos.y - rect.top;

    // 画布本地坐标 → 世界坐标
    const worldX = canvasX / this.zoom + this.origin.x;
    const worldY = canvasY / this.zoom + this.origin.y;

    const pageWidth = this.pageWidth;
    const pageHeight = this.pageHeight;
    if (pageWidth <= 0 || pageHeight <= 0) return null;

    // 由世界 X 确定落在哪一页（页 n 占 [(n-1)*pageWidth, n*pageWidth)，0-indexed）
    const pageIndex = Math.floor(worldX / pageWidth);
    const pages = this.board.pageOrder;
    if (!pages || pageIndex < 0 || pageIndex >= pages.length) return null;

    // 页内坐标（X 由 floor 除法保证在 [0, pageWidth)，无需额外检查）
    const pageLocalX = worldX - pageIndex * pageWidth;
    const pageLocalY = worldY;

    // 纵向边界检查
    if (pageLocalY < 0 || pageLocalY >= pageHeight) return null;

    return { pageId: pages[pageIndex], x: pageLocalX, y: pageLocalY };
  }
}

export { Monitor };
