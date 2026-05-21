/**
 * @file 显示器组件
 * @module core/components/monitor
 * @author Zhou Chenyu
 */

import { Board } from "../components/board.js";
import { ChunkBlockLoader } from "./chunk-block-loader.js";
import { CounterPool } from "../utils/counter-pool.js";
import { Vector } from "../utils/math.js";
import { DevicesTree, DevicesTreeNode } from "../devices/devices-tree.js";
import { joinPath } from "../utils/path.js";
import { Chunk } from "./chunk.js";
import { RenderScheduler } from "./render-scheduler.js";
import { LiveRenderer } from "./live-renderer.js";

/**
 * 显示器组件
 *
 * @class
 * @author Zhou Chenyu
 */
class Monitor {
  /**
   * 显示器组件的根元素
   * @type {HTMLElement | null}
   */
  rootElement;

  /**
   * 显示器组件的画布
   * @type {HTMLCanvasElement}
   * @todo 现在还没有转移到 React，所以用原生 html。
   */
  canvas;

  /**
   * 静态内容画布
   * @type {HTMLCanvasElement | null}
   */
  baseCanvas;

  /**
   * 活动内容画布
   * @type {HTMLCanvasElement}
   */
  liveCanvas;

  /**
   * UI 覆盖层画布
   * @type {HTMLCanvasElement | null}
   */
  uiCanvas;

  /**
   * 白板，用于查询区块顺序与区块尺寸
   * @type {Board}
   */
  board;

  /**
   * 区块加载器，用于按需加载区块内容
  * @type {ChunkBlockLoader}
   */
  chunkBlockLoader;

  /**
   * 显示器 id
   * @type {string}
   */
  monitorId;

  /**
   * 设备树
   * @type {DevicesTree}
   */
  devicesTree;

  /**
   * 当前显示器的渲染调度器
   * @type {RenderScheduler}
   */
  renderScheduler;

  /**
   * 活动层渲染器
   * @type {LiveRenderer}
   */
  liveRenderer;

  /**
   * canvas 左上角对应的世界坐标（可为负数）
   * @description 翻区块、平移、缩放后需整体更新此字段。
   * 初始值使第一区块在 canvas 中居中：
   *   origin.x = chunkWidth/2 - canvasWidth/(2×zoom)
   *   origin.y = chunkHeight/2 - canvasHeight/(2×zoom)
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
   * @param {string} monitorId - 显示器 id
   */
  constructor(canvas, board, { width, height }, monitorId) {
    this.rootElement = null;
    this.baseCanvas = null;
    this.liveCanvas = canvas;
    this.uiCanvas = null;
    this.canvas = canvas;
    this.board = board;
    this.chunkBlockLoader = this.board.createChunkBlockLoader();
    this.zoom = 1;
    this.monitorId = monitorId;
    const rect = canvas?.getBoundingClientRect();
    const canvasWidth = rect?.width ?? 0;
    const canvasHeight = rect?.height ?? 0;
    // 初始 origin 使第一区块居中显示。若 canvas 尚未布局，调用方应在布局后重新计算
    this.origin = new Vector(
      this.chunkWidth / 2 - canvasWidth / (2 * this.zoom),
      this.chunkHeight / 2 - canvasHeight / (2 * this.zoom),
    );
    this.resizeRenderLayers(width, height);
    this.canvas.id = `monitor-canvas-${monitorId}`;

    this.devicesTree = new DevicesTree();
    this.renderScheduler = new RenderScheduler();
    this.liveRenderer = new LiveRenderer(this, this.board?.activeObjectManager);
    this.renderScheduler.setFlushHandler(() => this.liveRenderer.flush());
  }

  /**
   * 绑定显示器的多层渲染画布
   * @param {{
   *   rootElement?: HTMLElement | null,
   *   baseCanvas?: HTMLCanvasElement | null,
   *   liveCanvas?: HTMLCanvasElement,
   *   uiCanvas?: HTMLCanvasElement | null,
   * }} renderLayers - 渲染层集合
   */
  attachRenderLayers({ rootElement, baseCanvas, liveCanvas, uiCanvas } = {}) {
    if (rootElement !== undefined) {
      this.rootElement = rootElement ?? null;
    }

    if (baseCanvas !== undefined) {
      this.baseCanvas = baseCanvas ?? null;
    }

    if (liveCanvas) {
      this.liveCanvas = liveCanvas;
      this.canvas = liveCanvas;
    }

    if (uiCanvas !== undefined) {
      this.uiCanvas = uiCanvas ?? null;
    }

    this.resizeRenderLayers(this.canvas?.width, this.canvas?.height);
  }

  /**
   * 调整所有渲染层尺寸
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   */
  resizeRenderLayers(width, height) {
    const canvases = [this.baseCanvas, this.liveCanvas, this.uiCanvas].filter(
      Boolean,
    );

    for (const layerCanvas of canvases) {
      layerCanvas.width = width;
      layerCanvas.height = height;
    }
  }

  /**
   * 获取指定渲染层的 2D 上下文
   * @param {"base" | "live" | "ui"} [layer = "live"] - 渲染层名称
   * @returns {CanvasRenderingContext2D | null}
   */
  getContext(layer = "live") {
    const layerCanvas = {
      base: this.baseCanvas,
      live: this.liveCanvas,
      ui: this.uiCanvas,
    }[layer];

    return layerCanvas?.getContext?.("2d") ?? null;
  }

  /**
   * 当前区块宽（取自 board）
   * @type {number}
   */
  get chunkWidth() {
    return this.board?.width ?? 0;
  }

  /**
   * 当前区块高（取自 board）
   * @type {number}
   */
  get chunkHeight() {
    return this.board?.height ?? 0;
  }

  /**
   * 将屏幕坐标映射到世界坐标
   * @param {Vector} screenPos - 屏幕坐标（clientX/clientY）
   * @returns {Vector | null}
   */
  screenToWorld(screenPos) {
    if (!this.canvas || !screenPos) return null;

    const rect = this.canvas.getBoundingClientRect();
    const canvasX = screenPos.x - rect.left;
    const canvasY = screenPos.y - rect.top;

    return new Vector(
      canvasX / this.zoom + this.origin.x,
      canvasY / this.zoom + this.origin.y,
    );
  }

  /**
   * 将世界坐标映射到区块空间坐标
   * @param {Vector} worldPos - 世界坐标
   * @returns {{ chunkId: number, x: number, y: number } | null}
   */
  worldToChunk(worldPos) {
    if (!this.board || !worldPos) return null;

    const chunkWidth = this.chunkWidth;
    const chunkHeight = this.chunkHeight;
    if (chunkWidth <= 0 || chunkHeight <= 0) return null;

    const chunkX = Math.floor(worldPos.x / chunkWidth);
    const chunkY = Math.floor(worldPos.y / chunkHeight);
    const chunkId = Chunk.coordinateToId(chunkX, chunkY);

    const chunkLocalX = worldPos.x - chunkX * chunkWidth;
    const chunkLocalY = worldPos.y - chunkY * chunkHeight;

    return { chunkId: chunkId, x: chunkLocalX, y: chunkLocalY };
  }

  /**
   * 将屏幕坐标映射到区块空间坐标
   *
   * @description
   * 由 Monitor 提供给 DeviceContext，封装了 origin、zoom 与区块尺寸。
   * 区块横向排列、无区块间空隙；触点超出所有区块的纵向范围时返回 null，Signal 管道自动短路。
   *
   * @param {Vector} screenPos - 屏幕坐标（clientX/clientY）
   * @returns {{ chunkId: number, x: number, y: number } | null}
   */
  screenToChunk(screenPos) {
    if (!this.canvas || !this.board) return null;
    const worldPos = this.screenToWorld(screenPos);
    if (!worldPos) return null;
    return this.worldToChunk(worldPos);
  }

  /**
   * 挂载设备到显示器的设备树
   *
   * @param {string} path - 设备路径（相对于显示器根节点，可带或不带前导 /）
   * @param {import("../devices/devices-tree.js").DeviceDefinition} deviceDefinition - 设备定义
   * @returns {DevicesTreeNode[]} 挂载后的设备树节点列表
   */
  mountDevice(path, deviceDefinition) {
    return this.devicesTree.mountDevice(
      joinPath(this.monitorId, path),
      deviceDefinition,
    );
  }

  /**
   * 在显示器设备树中运行时挂载工具。
   * @param {string} path - 挂载锚点路径（相对于显示器根）
   * @param {import("../tools/tool.js").Tool} tool - 要挂载的工具
   * @returns {DevicesTreeNode}
   */
  mountTool(path, tool) {
    return this.devicesTree.mountTool(joinPath(this.monitorId, path), tool, {
      board: this.board,
      monitor: this,
    });
  }

  /**
   * 在显示器设备树中运行时卸载末端工具。
   * @param {string} path - 卸载锚点路径（相对于显示器根）
   * @returns {boolean}
   */
  unmountTool(path) {
    return this.devicesTree.unmountTool(joinPath(this.monitorId, path));
  }
}

export { Monitor };
