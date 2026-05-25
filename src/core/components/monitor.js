/**
 * @file 显示器组件
 * @description 负责画布视口、块加载和渲染输出的调度与管理。
 * @module core/components/monitor
 * @author Zhou Chenyu
 */

import { Board } from "../components/board.js";
import { ChunkBlockLoader } from "./chunk-block-loader.js";
import { CounterPool } from "../utils/counter-pool.js";
import { Vector } from "../utils/math.js";
import { joinPath } from "../utils/path.js";
import { Chunk } from "./chunk.js";
import { ChunkObjectManager } from "./chunk-object-manager.js";
import { BaseRenderer } from "./base-renderer.js";
import {
  createBaseDirtyRectPolicyResolver,
  createBaseDirtyRectThresholdStrategy,
  createLiveDirtyRectPolicyResolver,
  createLiveDirtyRectThresholdStrategy,
} from "./dirty-rect-strategy.js";
import {
  createRectangleDirtyRectMerger,
  RenderScheduler,
} from "./render-scheduler.js";
import { LiveRenderer } from "./live-renderer.js";
import { RectangleRange } from "../range/index.js";

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
   *   uiCanvas?: HTMLCanvasElement | null,
   * }} htmlElements - 画布元素选项
   * @param {Board} board - 白板管理器
   * @param {{ width: number, height: number }} options - 画布尺寸选项
   * @param {string} monitorId - 显示器 id
   */
  constructor({ rootElement, baseCanvas, liveCanvas, uiCanvas }, board, { width, height }, monitorId) {
    this.attachRenderLayers({
      rootElement,
      baseCanvas,
      liveCanvas,
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
    this.baseRenderScheduler.setFlushHandler((dirtyRects) =>
      this.baseRenderer.flush(dirtyRects),
    );
    this.renderScheduler.setFlushHandler((dirtyRects) =>
      this.liveRenderer.flush(dirtyRects),
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
   * 当前白板级唯一设备树。
   * @type {import("../devices/devices-tree.js").DevicesTree}
   */
  get devicesTree() {
    return this.board?.devicesTree;
  }

  /**
   * 获取当前视口屏幕中心点
   * @returns {Vector}
   */
  getViewportScreenCenter() {
    return new Vector(
      (this.liveCanvas?.width ?? 0) / 2,
      (this.liveCanvas?.height ?? 0) / 2,
    );
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
   * 强制刷新当前视口的 base/live 全屏渲染
   */
  flushViewportRender() {
    const viewportRect = this.getViewportScreenRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;

    this.syncChunkBufferWithViewport();
    this.baseRenderScheduler?.invalidate?.(viewportRect);
    this.renderScheduler?.invalidate?.(viewportRect);
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

    if (liveCanvas !== undefined) {
      this.liveCanvas = liveCanvas ?? null;
    }

    if (uiCanvas !== undefined) {
      this.uiCanvas = uiCanvas ?? null;
    }

    this.resizeRenderLayers(this.liveCanvas?.width, this.liveCanvas?.height);
  }

  /**
   * 调整所有渲染层尺寸
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   */
  resizeRenderLayers(width, height) {
    const nextWidth = Number.isFinite(width) ? width : 0;
    const nextHeight = Number.isFinite(height) ? height : 0;
    const canvases = [this.baseCanvas, this.liveCanvas, this.uiCanvas].filter(
      Boolean,
    );
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
  }

  /**
   * 创建指定渲染层的脏区聚合器
   * @param {"base" | "live"} [layer = "live"] - 渲染层名称
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
   * @param {"base" | "live"} [layer = "live"] - 渲染层名称
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
   * @param {"base" | "live"} [layer = "live"] - 渲染层名称
   * @returns {Record<string, number | undefined>}
   */
  getDirtyRectThresholds(layer = "live") {
    return this.getDirtyRectPolicy(layer).getThresholds?.() ?? {};
  }

  /**
   * 获取当前视口屏幕矩形
   * @returns {RectangleRange}
   */
  getViewportScreenRect() {
    return new RectangleRange(
      0,
      0,
      this.liveCanvas?.width ?? 0,
      this.liveCanvas?.height ?? 0,
    );
  }

  /**
   * 获取当前视口对应的世界矩形
   * @param {Vector} [origin = this.origin] - 视口原点
   * @param {number} [zoom = this.zoom] - 缩放因子
   * @returns {RectangleRange}
   */
  getViewportWorldRect(origin = this.origin, zoom = this.zoom) {
    const viewportWidth = (this.liveCanvas?.width ?? 0) / zoom;
    const viewportHeight = (this.liveCanvas?.height ?? 0) / zoom;
    return new RectangleRange(
      origin.x,
      origin.y,
      viewportWidth,
      viewportHeight,
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
    if (!this.liveCanvas || !screenPos) return null;

    const rect = this.liveCanvas.getBoundingClientRect();
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
    if (!this.liveCanvas || !this.board) return null;
    const worldPos = this.screenToWorld(screenPos);
    if (!worldPos) return null;
    return this.worldToChunk(worldPos);
  }

  /**
   * 挂载设备到白板级设备树。
   * @param {string|import("../devices/devices-tree.js").DeviceDefinition} pathOrDeviceDefinition - 设备根路径或设备定义
   * @param {import("../devices/devices-tree.js").DeviceDefinition} [deviceDefinition] - 设备定义
   * @returns {import("../devices/devices-tree.js").DevicesTreeNode[]} 挂载后的设备树节点列表
   */
  mountDevice(pathOrDeviceDefinition, deviceDefinition) {
    const hasExplicitPath = typeof pathOrDeviceDefinition === "string";
    const resolvedDeviceDefinition = hasExplicitPath
      ? {
          ...deviceDefinition,
          root: pathOrDeviceDefinition,
        }
      : pathOrDeviceDefinition;

    return this.devicesTree.mountDevice(
      joinPath(this.monitorId),
      resolvedDeviceDefinition,
      {
        board: this.board,
        monitor: this,
      },
    );
  }

  /**
   * 在白板级设备树中运行时挂载工具。
   * @param {string} path - 工具叶子路径（相对于显示器根）
   * @param {import("../tools/tool.js").Tool} tool - 要挂载的工具
   * @returns {import("../devices/devices-tree.js").DevicesTreeNode}
   */
  mountTool(path, tool) {
    return this.devicesTree.mountTool(joinPath(this.monitorId, path), tool, {
      board: this.board,
      monitor: this,
    });
  }

  /**
   * 在白板级设备树中运行时卸载工具叶子节点。
   * @param {string} path - 工具叶子路径（相对于显示器根）
   * @returns {boolean}
   */
  unmountTool(path) {
    return this.devicesTree.unmountTool(joinPath(this.monitorId, path), {
      runtimeContext: {
        board: this.board,
        monitor: this,
      },
    });
  }
}

export { Monitor };
