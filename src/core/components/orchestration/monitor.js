/**
 * @file 显示器组件
 * @description 负责画布视口、块加载和渲染输出的调度与管理。
 * @module core/components/monitor
 * @author Zhou Chenyu
 */

import { Board } from "./board.js";
import { ChunkBlockLoader } from "../chunk/chunk-block-loader.js";
import { CounterPool } from "../../utils/counter-pool.js";
import { Vector } from "../../utils/math.js";
import { joinPath } from "../../utils/path.js";
import { Chunk } from "../chunk/chunk.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { BaseRenderer } from "../renderer/base-renderer.js";
import {
  createBaseDirtyRectPolicyResolver,
  createBaseDirtyRectThresholdStrategy,
  createLiveDirtyRectPolicyResolver,
  createLiveDirtyRectThresholdStrategy,
} from "../renderer/dirty-rect-strategy.js";
import {
  createRectangleDirtyRectMerger,
  RenderScheduler,
} from "../renderer/render-scheduler.js";
import { LiveRenderer } from "../renderer/live-renderer.js";
import { RectangleRange } from "../../range/index.js";
import { UiRenderer } from "../renderer/ui-renderer.js";

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
   * 静态内容画布（不可见）
   * @type {HTMLCanvasElement | null}
   */
  baseCanvas;

  /**
   * 活动内容画布（不可见）
   * @type {HTMLCanvasElement | null}
   */
  liveCanvas;

  /**
   * UI 覆盖层画布
   * @type {HTMLCanvasElement | null}
   */
  uiCanvas;

  /**
   * 合成输出画布（可见，负责将 baseCanvas + liveCanvas 合成到屏幕）
   * @type {HTMLCanvasElement | null}
   */
  renderCanvas;

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
   * 当前显示器的静态层渲染调度器
   * @type {RenderScheduler}
   */
  baseRenderScheduler;

  /**
   * 当前显示器的渲染调度器
   * @type {RenderScheduler}
   */
  renderScheduler;

  /**
   * 当前显示器的 UI 层渲染调度器
   * @type {RenderScheduler}
   */
  uiRenderScheduler;

  /**
   * 静态层渲染器
   * @type {BaseRenderer}
   */
  baseRenderer;

  /**
   * 活动层渲染器
   * @type {LiveRenderer}
   */
  liveRenderer;

  /**
   * UI 覆盖层渲染器
   * @type {UiRenderer}
   */
  uiRenderer;

  /**
   * canvas 左上角对应的世界坐标（可为负数）
   * @description 翻区块、平移、缩放后需整体更新此字段。
   * 初始值使第一区块在 canvas 中居中：
   *   origin.x = chunkWidth/2 - canvasWidth/(2×zoom)
   *   origin.y = chunkHeight/2 - canvasHeight/(2×zoom)
   * @type {Vector}
   */
  _origin;

  /**
   * 缩放因子
   * @description 1.0 = 默认比例，>1 = 放大，<1 = 缩小。
   * @type {number}
   */
  _zoom;

  /**
   * 上一次缓冲区区块快照
   * @type {Chunk[]}
   */
  baseBufferedChunks;

  /**
   * 静态层 dirty rect 阈值策略
   * @type {(zoom: number) => Record<string, number | undefined>}
   */
  baseDirtyRectThresholdStrategy;

  /**
   * 活动层 dirty rect 阈值策略
   * @type {(zoom: number) => Record<string, number | undefined>}
   */
  liveDirtyRectThresholdStrategy;

  /**
   * 静态层 dirty rect policy 解析器
   * @type {() => {
   *   getThresholds?: () => Record<string, number | undefined>,
   *   getViewportRect?: () => any,
   *   getCanonicalRectsForRect?: (dirtyRect: any) => any[],
   * }}
   */
  baseDirtyRectPolicyResolver;

  /**
   * 活动层 dirty rect policy 解析器
   * @type {() => {
   *   getThresholds?: () => Record<string, number | undefined>,
   *   getViewportRect?: () => any,
   *   getCanonicalRectsForRect?: (dirtyRect: any) => any[],
   * }}
   */
  liveDirtyRectPolicyResolver;

  /**
   * @param {{
   *   rootElement?: HTMLElement | null,
   *   baseCanvas?: HTMLCanvasElement | null,
   *   liveCanvas?: HTMLCanvasElement | null,
   *   renderCanvas?: HTMLCanvasElement | null,
   *   uiCanvas?: HTMLCanvasElement | null,
   * }} htmlElements - 画布元素选项
   * @param {Board} board - 白板管理器
   * @param {{ width: number, height: number }} options - 画布尺寸选项
   * @param {string} monitorId - 显示器 id
   */
  constructor(
    { rootElement, baseCanvas, liveCanvas, renderCanvas, uiCanvas },
    board,
    { width, height },
    monitorId,
  ) {
    this.attachRenderLayers({
      rootElement,
      baseCanvas,
      liveCanvas,
      renderCanvas,
      uiCanvas,
    });
    this.board = board;
    this.chunkBlockLoader = this.board.createChunkBlockLoader();
    this._zoom = 1;
    this.monitorId = monitorId;
    this.baseBufferedChunks = [];
    const rect = this.liveCanvas?.getBoundingClientRect();
    const canvasWidth = rect?.width ?? 0;
    const canvasHeight = rect?.height ?? 0;
    // 初始 origin 使第一区块居中显示。若 canvas 尚未布局，调用方应在布局后重新计算
    this._origin = new Vector(
      this.chunkWidth / 2 - canvasWidth / (2 * this._zoom),
      this.chunkHeight / 2 - canvasHeight / (2 * this._zoom),
    );
    this.resizeRenderLayers(width, height);

    this.baseRenderer = new BaseRenderer(this);
    this.liveRenderer = new LiveRenderer(this, this.board?.activeObjectManager);
    this.uiRenderer = new UiRenderer(this, this.board?.activeObjectManager);
    this.baseDirtyRectThresholdStrategy =
      createBaseDirtyRectThresholdStrategy();
    this.liveDirtyRectThresholdStrategy =
      createLiveDirtyRectThresholdStrategy();
    this.baseDirtyRectPolicyResolver = createBaseDirtyRectPolicyResolver({
      getOrigin: () => this.origin,
      getZoom: () => this.zoom,
      getLoadedChunks: () => this.chunkBlockLoader?.getLoadedChunks?.() ?? [],
      getChunkById: (chunkId) => this.board?.getChunkById?.(chunkId),
      getChunkWidth: () => this.chunkWidth,
      getChunkHeight: () => this.chunkHeight,
      getChunkScreenRect: (chunk) =>
        this.baseRenderer?.getChunkScreenRect?.(chunk),
      getThresholds: () =>
        this.baseDirtyRectThresholdStrategy?.(this.zoom) ?? {},
      getViewportRect: () => this.getViewportScreenRect(),
    });
    this.liveDirtyRectPolicyResolver = createLiveDirtyRectPolicyResolver({
      getZoom: () => this.zoom,
      getThresholds: () =>
        this.liveDirtyRectThresholdStrategy?.(this.zoom) ?? {},
      getViewportRect: () => this.getViewportScreenRect(),
    });
    this.baseRenderScheduler = new RenderScheduler({
      mergeDirtyRects: this.createDirtyRectMerger("base"),
    });
    this.renderScheduler = new RenderScheduler({
      mergeDirtyRects: this.createDirtyRectMerger("live"),
    });
    this.uiRenderScheduler = new RenderScheduler({
      mergeDirtyRects: this.createDirtyRectMerger("ui"),
    });
    this.baseRenderScheduler.setFlushHandler((dirtyRects) => {
      this.baseRenderer.flush(dirtyRects);
      this.requestCompositeRender();
    });
    this.renderScheduler.setFlushHandler((dirtyRects) => {
      this.liveRenderer.flush(dirtyRects);
      this.requestCompositeRender();
    });
    this.uiRenderScheduler.setFlushHandler((dirtyRects) =>
      this.uiRenderer.flush(dirtyRects),
    );
    this.bindChunkBlockLoaderRenderHook();
  }

  /**
   * 当前视口原点
   * @type {Vector}
   */
  get origin() {
    return this._origin;
  }

  set origin(value) {
    this.setViewportState({ origin: value });
  }

  /**
   * 当前缩放因子
   * @type {number}
   */
  get zoom() {
    return this._zoom;
  }

  set zoom(value) {
    this.setViewportState({ zoom: value });
  }

  /**
   * 当前白板级唯一设备图
   * @type {import("../../devices-dag/dag.js").DevicesDAG}
   */
  get devicesDAG() {
    return this.board?.devicesDAG;
  }

  /**
   * 当前显示器画布宽度
   * @type {number}
   */
  get width() {
    return this.canvas?.width ?? 0;
  }

  /**
   * 当前显示器画布高度
   * @type {number}
   */
  get height() {
    return this.canvas?.height ?? 0;
  }

  /**
   * 当前显示器的可见画布（renderCanvas > liveCanvas > baseCanvas）
   * @type {HTMLCanvasElement | null}
   */
  get canvas() {
    return this.renderCanvas ?? this.liveCanvas ?? this.baseCanvas ?? null;
  }

  /**
   * 当前视口屏幕中心点
   * @returns {Vector}
   */
  getViewportScreenCenter() {
    return new Vector(this.width / 2, this.height / 2);
  }

  /**
   * 以当前视口参数将屏幕点映射到世界坐标
   * @param {Vector | {x:number, y:number}} screenPoint - 屏幕坐标
   * @param {Vector} [origin = this.origin] - 视口原点
   * @param {number} [zoom = this.zoom] - 缩放因子
   * @returns {Vector}
   */
  screenPointToWorld(screenPoint, origin = this.origin, zoom = this.zoom) {
    const normalizedPoint =
      screenPoint instanceof Vector
        ? screenPoint
        : new Vector(screenPoint?.x ?? 0, screenPoint?.y ?? 0);

    return new Vector(
      normalizedPoint.x / zoom + origin.x,
      normalizedPoint.y / zoom + origin.y,
    );
  }

  /**
   * 统一更新视口状态，并触发 base/live 补绘
   * @param {{ origin?: Vector | {x:number, y:number}, zoom?: number }} nextState - 新视口状态
   */
  setViewportState(nextState = {}) {
    const previousChunks = this.getVisibleChunksForViewport();
    const previousViewportState = {
      origin: this.origin,
      zoom: this.zoom,
    };
    const nextOrigin =
      nextState.origin === undefined
        ? this.origin
        : nextState.origin instanceof Vector
          ? nextState.origin
          : new Vector(
              nextState.origin?.x ?? this.origin.x,
              nextState.origin?.y ?? this.origin.y,
            );
    const nextZoom =
      nextState.zoom === undefined
        ? this.zoom
        : Number.isFinite(nextState.zoom) && nextState.zoom > 0
          ? nextState.zoom
          : this.zoom;

    this._origin = nextOrigin;
    this._zoom = nextZoom;
    this.requestViewportBaseRender(previousChunks, previousViewportState);
    this.requestViewportLiveRender();
    this.requestViewportUiRender();
  }

  /**
   * 将视口原点移动到指定世界坐标
   * @param {Vector | {x:number, y:number}} position - 新视口原点
   */
  setViewportPosition(position) {
    this.setViewportState({ origin: position });
  }

  /**
   * 以指定屏幕锚点调整缩放因子
   * @param {number} scale - 新缩放因子
   * @param {Vector | {x:number, y:number}} [screenAnchor = this.getViewportScreenCenter()] - 屏幕锚点
   */
  setViewportScale(scale, screenAnchor = this.getViewportScreenCenter()) {
    const nextZoom = Number.isFinite(scale) && scale > 0 ? scale : this.zoom;
    const normalizedAnchor =
      screenAnchor instanceof Vector
        ? screenAnchor
        : new Vector(screenAnchor?.x ?? 0, screenAnchor?.y ?? 0);
    const anchorWorld = this.screenPointToWorld(normalizedAnchor);

    this.setViewportState({
      zoom: nextZoom,
      origin: new Vector(
        anchorWorld.x - normalizedAnchor.x / nextZoom,
        anchorWorld.y - normalizedAnchor.y / nextZoom,
      ),
    });
  }

  /**
   * 以当前视口中心点为锚点调整缩放
   * @param {number} scale - 新缩放因子
   */
  setViewportScaleAroundCenter(scale) {
    this.setViewportScale(scale, this.getViewportScreenCenter());
  }

  /**
   * 请求一次视口范围内的活动层补绘
   */
  requestViewportLiveRender() {
    const viewportRect = this.getViewportScreenRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;
    this.renderScheduler?.invalidate?.(viewportRect);
  }

  /**
   * 请求一次视口范围内的 UI 层补绘
   */
  requestViewportUiRender() {
    const viewportRect = this.getViewportScreenRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;
    this.uiRenderScheduler?.invalidate?.(viewportRect);
  }

  /**
   * 强制刷新当前视口的 base/live 全屏渲染
   */
  flushViewportRender() {
    const viewportRect = this.getViewportScreenRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;

    this.syncChunkBufferWithViewport();
    this.baseRenderScheduler?.invalidate?.(viewportRect);
    this.renderScheduler?.invalidate?.(viewportRect);
    this.uiRenderScheduler?.invalidate?.(viewportRect);
    this.requestCompositeRender();
  }

  /**
   * 绑定显示器的多层渲染画布
   * @param {{
   *   rootElement?: HTMLElement | null,
   *   baseCanvas?: HTMLCanvasElement | null,
   *   liveCanvas?: HTMLCanvasElement | null,
   *   renderCanvas?: HTMLCanvasElement | null,
   *   uiCanvas?: HTMLCanvasElement | null,
   * }} renderLayers - 渲染层集合
   */
  attachRenderLayers({
    rootElement,
    baseCanvas,
    liveCanvas,
    renderCanvas,
    uiCanvas,
  } = {}) {
    if (rootElement !== undefined) {
      this.rootElement = rootElement ?? null;
    }

    if (baseCanvas !== undefined) {
      this.baseCanvas = baseCanvas ?? null;
    }

    if (liveCanvas !== undefined) {
      this.liveCanvas = liveCanvas ?? null;
    }

    if (renderCanvas !== undefined) {
      this.renderCanvas = renderCanvas ?? null;
    }

    if (uiCanvas !== undefined) {
      this.uiCanvas = uiCanvas ?? null;
    }

    this.resizeRenderLayers(this.width, this.height);
  }

  /**
   * 调整所有渲染层尺寸
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   */
  resizeRenderLayers(width, height) {
    const nextWidth = Number.isFinite(width) ? width : 0;
    const nextHeight = Number.isFinite(height) ? height : 0;
    const canvases = [
      this.baseCanvas,
      this.liveCanvas,
      this.renderCanvas,
      this.uiCanvas,
    ].filter(Boolean);
    let resized = false;

    for (const layerCanvas of canvases) {
      if (
        layerCanvas.width === nextWidth &&
        layerCanvas.height === nextHeight
      ) {
        continue;
      }

      layerCanvas.width = nextWidth;
      layerCanvas.height = nextHeight;
      resized = true;
    }

    if (resized) {
      this.requestRenderLayersRefresh();
    }
  }

  /**
   * 在渲染层尺寸变化后请求 base/live 补绘
   */
  requestRenderLayersRefresh() {
    const viewportRect = this.getViewportScreenRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;

    this.requestViewportBaseRender();
    this.renderScheduler?.invalidate?.(viewportRect);
    this.uiRenderScheduler?.invalidate?.(viewportRect);
    this.requestCompositeRender();
  }

  /**
   * 合成待处理标志
   * @type {boolean}
   */
  _compositePending = false;

  /**
   * 请求一次合成渲染（异步去重）
   */
  requestCompositeRender() {
    if (this._compositePending) return;
    this._compositePending = true;

    const scheduleFrame =
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame
        : (cb) => globalThis.setTimeout(() => cb(Date.now()), 16);

    scheduleFrame(() => {
      this._compositePending = false;
      this.compositeRenderCanvas();
    });
  }

  /**
   * 合成 baseCanvas + liveCanvas 到 renderCanvas
   * @description 执行全量合成：clearRect → drawImage(baseCanvas) → drawImage(liveCanvas)
   */
  compositeRenderCanvas() {
    const ctx = this.getContext("render");
    if (!ctx || !this.renderCanvas) return;

    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 清为透明
    ctx.clearRect(0, 0, w, h);
    // 合成：静态层 → 活动层（Canvas 2D source-over 是自洽的）
    ctx.drawImage(this.baseCanvas, 0, 0);
    ctx.drawImage(this.liveCanvas, 0, 0);
    ctx.restore();
  }

  /**
   * 创建指定渲染层的脏区聚合器
   * @param {"base" | "live" | "ui"} [layer = "live"] - 渲染层名称
   * @returns {(dirtyRects: any[]) => any[]}
   */
  createDirtyRectMerger(layer = "live") {
    const getDirtyRectPolicy = () => this.getDirtyRectPolicy(layer);

    return createRectangleDirtyRectMerger({
      getThresholds: () => getDirtyRectPolicy().getThresholds?.() ?? {},
      getViewportRect: () => getDirtyRectPolicy().getViewportRect?.(),
      getCanonicalRectsForRect: (dirtyRect) =>
        getDirtyRectPolicy().getCanonicalRectsForRect?.(dirtyRect),
    });
  }

  /**
   * 获取指定渲染层当前 dirty rect policy
   * @param {"base" | "live" | "ui"} [layer = "live"] - 渲染层名称
   * @returns {{
   *   getThresholds?: () => Record<string, number | undefined>,
   *   getViewportRect?: () => any,
   *   getCanonicalRectsForRect?: (dirtyRect: any) => any[],
   * }}
   */
  getDirtyRectPolicy(layer = "live") {
    const resolver =
      layer === "base"
        ? this.baseDirtyRectPolicyResolver
        : this.liveDirtyRectPolicyResolver;

    return resolver?.() ?? {};
  }

  /**
   * 获取指定渲染层当前 dirty rect 阈值
   * @param {"base" | "live" | "ui"} [layer = "live"] - 渲染层名称
   * @returns {Record<string, number | undefined>}
   */
  getDirtyRectThresholds(layer = "live") {
    return this.getDirtyRectPolicy(layer).getThresholds?.() ?? {};
  }

  /**
   * 注册 UI overlay provider
   * @param {Function} provider - overlay provider
   * @param {{ invalidate?: boolean }} [options={}] - 附加选项
   * @returns {Function | undefined}
   */
  registerUiOverlayProvider(provider, options = {}) {
    const registeredProvider =
      this.uiRenderer?.registerOverlayProvider?.(provider);

    if (registeredProvider && options.invalidate !== false) {
      this.requestViewportUiRender();
    }

    return registeredProvider;
  }

  /**
   * 注销 UI overlay provider
   * @param {Function} provider - overlay provider
   * @param {{ invalidate?: boolean }} [options={}] - 附加选项
   * @returns {boolean}
   */
  unregisterUiOverlayProvider(provider, options = {}) {
    const removed =
      this.uiRenderer?.unregisterOverlayProvider?.(provider) ?? false;

    if (removed && options.invalidate !== false) {
      this.requestViewportUiRender();
    }

    return removed;
  }

  /**
   * 获取当前视口屏幕矩形
   * @returns {RectangleRange}
   */
  getViewportScreenRect() {
    return new RectangleRange(0, 0, this.width, this.height);
  }

  /**
   * 获取当前视口对应的世界矩形
   * @param {Vector} [origin = this.origin] - 视口原点
   * @param {number} [zoom = this.zoom] - 缩放因子
   * @returns {RectangleRange}
   */
  getViewportWorldRect(origin = this.origin, zoom = this.zoom) {
    const viewportWidth = this.width / zoom;
    const viewportHeight = this.height / zoom;
    return new RectangleRange(0, 0, viewportWidth, viewportHeight).withPosition(
      origin,
    );
  }

  /**
   * 获取当前视口可见区块集合
   * @param {Vector} [origin = this.origin] - 视口原点
   * @param {number} [zoom = this.zoom] - 缩放因子
   * @returns {Chunk[]}
   */
  getVisibleChunksForViewport(origin = this.origin, zoom = this.zoom) {
    if (!this.board || this.chunkWidth <= 0 || this.chunkHeight <= 0) {
      return [];
    }

    const viewportWorldRect = this.getViewportWorldRect(origin, zoom);
    const chunkIds = ChunkObjectManager.calculateCoveredChunkIdsForRange(
      viewportWorldRect,
      this.chunkWidth,
      this.chunkHeight,
    );

    return [...chunkIds]
      .map((chunkId) => this.board.getChunkById?.(chunkId))
      .filter(Boolean);
  }

  /**
   * 让 chunkBlockLoader 至少覆盖当前视口可见区块
   * @param {Vector} [origin = this.origin] - 视口原点
   * @param {number} [zoom = this.zoom] - 缩放因子
   * @returns {Chunk[]} 当前视口可见区块
   */
  syncChunkBufferWithViewport(origin = this.origin, zoom = this.zoom) {
    const visibleChunks = this.getVisibleChunksForViewport(origin, zoom);
    const chunkBlockLoader = this.chunkBlockLoader;
    const shouldPreserveLoadedChunks =
      typeof this.board?.isPersistent === "function"
        ? !this.board.isPersistent()
        : false;

    if (
      !chunkBlockLoader?.getLoadedChunks ||
      !chunkBlockLoader?.resetBuffer ||
      !chunkBlockLoader?.initChunkByCoordinate
    ) {
      return visibleChunks;
    }

    const visibleChunkIds = new Set(
      visibleChunks
        .map((chunk) => chunk?.id)
        .filter((chunkId) => Number.isInteger(chunkId)),
    );
    const loadedChunkIds = new Set(
      (chunkBlockLoader.getLoadedChunks?.() ?? [])
        .map((chunk) => chunk?.id)
        .filter((chunkId) => Number.isInteger(chunkId)),
    );

    if (
      [...visibleChunkIds].every((chunkId) => loadedChunkIds.has(chunkId)) &&
      (shouldPreserveLoadedChunks ||
        visibleChunkIds.size === loadedChunkIds.size)
    ) {
      return visibleChunks;
    }

    if (visibleChunks.length === 0) {
      if (!shouldPreserveLoadedChunks) {
        chunkBlockLoader.resetBuffer();
      }
      return visibleChunks;
    }

    const chunkXs = visibleChunks.map((chunk) => chunk.x);
    const chunkYs = visibleChunks.map((chunk) => chunk.y);
    const minX = Math.min(...chunkXs);
    const maxX = Math.max(...chunkXs);
    const minY = Math.min(...chunkYs);
    const maxY = Math.max(...chunkYs);

    if (shouldPreserveLoadedChunks) {
      const currentBounds = chunkBlockLoader.getBufferBounds?.();
      const hasLoadedChunks =
        (chunkBlockLoader.getLoadedChunks?.()?.length ?? 0) > 0;

      if (!hasLoadedChunks || !currentBounds) {
        const firstChunk = chunkBlockLoader.initChunkByCoordinate(minX, minY);
        if (!firstChunk) {
          return visibleChunks;
        }

        for (let currentX = minX + 1; currentX <= maxX; currentX += 1) {
          chunkBlockLoader.expandBufferRightFullLoad?.();
        }

        for (let currentY = minY + 1; currentY <= maxY; currentY += 1) {
          chunkBlockLoader.expandBufferUpFullLoad?.();
        }

        return visibleChunks;
      }

      let nextBounds = currentBounds;
      while (nextBounds.minX > minX) {
        chunkBlockLoader.expandBufferLeftFullLoad?.();
        nextBounds = chunkBlockLoader.getBufferBounds?.() ?? nextBounds;
      }
      while (nextBounds.maxX < maxX) {
        chunkBlockLoader.expandBufferRightFullLoad?.();
        nextBounds = chunkBlockLoader.getBufferBounds?.() ?? nextBounds;
      }
      while (nextBounds.minY > minY) {
        chunkBlockLoader.expandBufferDownFullLoad?.();
        nextBounds = chunkBlockLoader.getBufferBounds?.() ?? nextBounds;
      }
      while (nextBounds.maxY < maxY) {
        chunkBlockLoader.expandBufferUpFullLoad?.();
        nextBounds = chunkBlockLoader.getBufferBounds?.() ?? nextBounds;
      }

      return visibleChunks;
    }

    chunkBlockLoader.resetBuffer();
    const firstChunk = chunkBlockLoader.initChunkByCoordinate(minX, minY);
    if (!firstChunk) {
      return visibleChunks;
    }

    for (let currentX = minX + 1; currentX <= maxX; currentX += 1) {
      chunkBlockLoader.expandBufferRightFullLoad?.();
    }

    for (let currentY = minY + 1; currentY <= maxY; currentY += 1) {
      chunkBlockLoader.expandBufferUpFullLoad?.();
    }

    return visibleChunks;
  }

  /**
   * 请求一次视口范围内的静态层重绘
   * @param {Chunk[]} [previousChunks = []] - 视口变化前可见区块
   */
  requestViewportBaseRender(previousChunks = [], previousViewportState = {}) {
    const currentChunks = this.syncChunkBufferWithViewport();

    if (currentChunks.length > 0 || previousChunks.length > 0) {
      this.baseRenderer?.invalidateChunks?.(currentChunks, previousChunks, {
        previousViewportState,
      });
      return;
    }

    const viewportRect = this.getViewportScreenRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;
    this.baseRenderScheduler?.invalidate?.(viewportRect);
  }

  /**
   * 将当前 chunkBlockLoader 的缓冲区更新接到 baseRenderer
   */
  bindChunkBlockLoaderRenderHook() {
    const chunkLoader = this.chunkBlockLoader?.chunkLoader;
    if (!chunkLoader || chunkLoader.__baseRenderHookBound) return;

    const originalEmitBufferUpdated =
      chunkLoader.emitBufferUpdated.bind(chunkLoader);
    this.baseBufferedChunks = this.chunkBlockLoader?.getLoadedChunks?.() ?? [];

    chunkLoader.emitBufferUpdated = (payload = {}) => {
      const previousChunks = this.baseBufferedChunks;
      const currentChunks =
        payload.chunksLoaded ??
        this.chunkBlockLoader?.getLoadedChunks?.() ??
        [];
      this.baseBufferedChunks = [...currentChunks];
      this.baseRenderer?.invalidateChunks?.(currentChunks, previousChunks);
      return originalEmitBufferUpdated(payload);
    };
    chunkLoader.__baseRenderHookBound = true;
  }

  /**
   * 获取指定渲染层的 2D 上下文
   * @param {"base" | "live" | "ui" | "render"} [layer = "live"] - 渲染层名称
   * @returns {CanvasRenderingContext2D | null}
   */
  getContext(layer = "live") {
    const layerCanvas = {
      base: this.baseCanvas,
      live: this.liveCanvas,
      render: this.renderCanvas,
      ui: this.uiCanvas,
    }[layer];

    return layerCanvas?.getContext?.("2d") ?? null;
  }

  /**
   * 将世界矩形范围映射到屏幕矩形范围
   * @param {RectangleRange | { left: number, top: number, width: number, height: number }} rect - 世界矩形
   * @param {number} [padding = 0] - 额外屏幕像素留白
   * @returns {RectangleRange | undefined}
   */
  worldRectToScreenRect(rect, padding = 0) {
    if (!rect) return undefined;

    const left = (rect.left - this.origin.x) * this.zoom - padding;
    const top = (rect.top - this.origin.y) * this.zoom - padding;
    const width = rect.width * this.zoom + padding * 2;
    const height = rect.height * this.zoom + padding * 2;

    return new RectangleRange(left, top, width, height);
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
   * 挂载子图到白板级设备图
   * @param {string} path - 子图根路径（相对于显示器根）
   * @param {import("../../devices-dag/dag.js").SubDAGDefinition} subDAGDefinition - 子图定义
   */
  mountSubDAG(path, subDAGDefinition) {
    return this.devicesDAG.mountSubDAG(this.monitorId, {
      ...subDAGDefinition,
      rootPath: path || subDAGDefinition.rootPath,
    });
  }

  /**
   * 在白板级设备图中运行时挂载 workflow。
   * @param {string} path - workflow 路径（相对于显示器根）
   * @param {import("../../tools/tool.js").Tool|import("../../devices-dag/dag.js").SubDAGDefinition} workflow - 要挂载的 workflow 入口
   */
  mountWorkflow(path, workflow) {
    return this.devicesDAG.mountWorkflow(
      joinPath(this.monitorId, path),
      workflow,
      {
        board: this.board,
        monitor: this,
      },
    );
  }

  /**
   * 在白板级设备图中运行时卸载 workflow 节点。
   * @param {string} path - workflow 路径（相对于显示器根）
   * @returns {boolean}
   */
  unmountWorkflow(path) {
    return this.devicesDAG.unmountWorkflow(joinPath(this.monitorId, path), {
      board: this.board,
      monitor: this,
    });
  }

  /**
   * 在白板级设备图中添加有向边。
   * @param {string} fromPath - 源节点路径（相对于显示器根）
   * @param {string} edgeName - 边名
   * @param {string} toPath - 目标节点路径（相对于显示器根）
   * @returns {import("../../devices-dag/dag.js").DevicesDAGEdge}
   */
  addEdge(fromPath, edgeName, toPath) {
    return this.devicesDAG.addEdge(
      joinPath(this.monitorId, fromPath),
      edgeName,
      joinPath(this.monitorId, toPath),
    );
  }
}

export { Monitor };
