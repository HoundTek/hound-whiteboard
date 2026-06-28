/**
 * @file 显示器组件
 * @description 负责画布视口、块加载和渲染协调。
 * @module core/components/monitor
 * @author Zhou Chenyu
 */

import { Board } from "./board.js";
import { Vector } from "../../utils/math.js";
import { joinPath } from "../../utils/path.js";
import { Chunk } from "../chunk/chunk.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { BaseRenderer } from "../renderer/base-renderer.js";
import { LiveRenderer } from "../renderer/live-renderer.js";
import { UiRenderer } from "../renderer/ui-renderer.js";
import { RectangleRange } from "../../range/index.js";

/**
 * 显示器组件
 * @description
 * 协调视口管理、chunk 加载与三层渲染器的调度入口。
 * 渲染调度链（scheduler、dirty rect 策略、canvas 管理）已完全内聚到渲染器内部。
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
   * 白板，用于查询区块顺序与区块尺寸
   * @type {Board}
   */
  board;

  /**
   * 区块加载器，用于按需加载区块内容
   * @type {import("../chunk/chunk-loader.js").ChunkLoader}
   */
  chunkLoader;

  /**
   * 显示器 id
   * @type {string}
   */
  monitorId;

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
   * @description 平移、缩放后需整体更新此字段。
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
  constructor(
    { rootElement, baseCanvas, liveCanvas, uiCanvas },
    board,
    { width, height },
    monitorId,
  ) {
    this.rootElement = rootElement ?? null;
    this.board = board;
    this.chunkLoader = board?.createChunkLoader?.(`monitor-${monitorId}`);
    this._zoom = 1;
    this.monitorId = monitorId;

    this.baseRenderer = new BaseRenderer(this, {
      canvas: baseCanvas,
    });

    this.liveRenderer = new LiveRenderer(this, board?.activeObjectManager, {
      canvas: liveCanvas,
    });

    this.uiRenderer = new UiRenderer(this, board?.activeObjectManager, {
      canvas: uiCanvas,
    });

    const liveCanvasRect = liveCanvas?.getBoundingClientRect();
    const canvasWidth = liveCanvasRect?.width ?? 0;
    const canvasHeight = liveCanvasRect?.height ?? 0;
    this._origin = new Vector(
      this.chunkWidth / 2 - canvasWidth / (2 * this._zoom),
      this.chunkHeight / 2 - canvasHeight / (2 * this._zoom),
    );
    this.resizeRenderLayers(width, height);
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
   * 当前显示器的可见画布（liveCanvas）
   * @type {HTMLCanvasElement | null}
   */
  get canvas() {
    return this.liveRenderer?.canvas ?? null;
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
   * 统一更新视口状态
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
    this.liveRenderer?.invalidateViewport();
    this.uiRenderer?.invalidateViewport();
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
    this.liveRenderer?.invalidateViewport();
  }

  /**
   * 请求一次视口范围内的 UI 层补绘
   */
  requestViewportUiRender() {
    this.uiRenderer?.invalidateViewport();
  }

  /**
   * 强制刷新当前视口的全屏渲染
   */
  flushViewportRender() {
    const viewportRect = this.getViewportScreenRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;

    this.syncChunkBufferWithViewport();
    this.baseRenderer?.invalidate(viewportRect);
    this.liveRenderer?.invalidate(viewportRect);
    this.uiRenderer?.invalidate(viewportRect);
  }

  /**
   * 调整所有渲染层尺寸
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   */
  resizeRenderLayers(width, height) {
    let resized = false;
    if (this.baseRenderer?.resize(width, height)) resized = true;
    if (this.liveRenderer?.resize(width, height)) resized = true;
    if (this.uiRenderer?.resize(width, height)) resized = true;

    if (resized) {
      this.requestRenderLayersRefresh();
    }
  }

  /**
   * 在渲染层尺寸变化后请求补绘
   */
  requestRenderLayersRefresh() {
    this.requestViewportBaseRender();
    this.liveRenderer?.invalidateViewport();
    this.uiRenderer?.invalidateViewport();
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
      this.uiRenderer?.invalidateViewport();
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
      this.uiRenderer?.invalidateViewport();
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
   * 使 chunkLoader 覆盖 2x 视口的加载区域
   * @description 加载区 = 视口世界矩形向四周各扩展 50%。
   * @param {Vector} [origin = this.origin] - 视口原点
   * @param {number} [zoom = this.zoom] - 缩放因子
   * @returns {Chunk[]} 当前视口可见区块
   */
  syncChunkBufferWithViewport(origin = this.origin, zoom = this.zoom) {
    const board = this.board;
    const chunkLoader = this.chunkLoader;
    const chunkWidth = this.chunkWidth;
    const chunkHeight = this.chunkHeight;

    if (!board || chunkWidth <= 0 || chunkHeight <= 0) return [];

    const viewportRect = this.getViewportWorldRect(origin, zoom);

    const loadRect = new RectangleRange(
      viewportRect.left - viewportRect.width / 2,
      viewportRect.top - viewportRect.height / 2,
      viewportRect.width * 2,
      viewportRect.height * 2,
    );

    const targetChunkIds = ChunkObjectManager.calculateCoveredChunkIdsForRange(
      loadRect,
      chunkWidth,
      chunkHeight,
    );

    if (targetChunkIds.size === 0) {
      return [];
    }

    const loadedChunks = chunkLoader?.getLoadedChunks?.() ?? [];
    const loadedChunkIds = new Set(loadedChunks.map((c) => c.id));

    for (const chunkId of targetChunkIds) {
      if (loadedChunkIds.has(chunkId)) continue;
      const chunk = chunkLoader?.getChunkById?.(chunkId);
      if (chunk) {
        chunkLoader?.emitLoadRequest?.(chunk, { strategy: "full" });
      }
    }

    const shouldPreserve =
      typeof board.isPersistent === "function" ? !board.isPersistent() : false;

    if (!shouldPreserve) {
      for (const chunk of loadedChunks) {
        if (targetChunkIds.has(chunk.id)) continue;
        chunkLoader?.emitUnloadRequest?.(chunk);
        chunkLoader?.untrackChunkById?.(chunk.id);
      }
    }

    return this.getVisibleChunksForViewport(origin, zoom);
  }

  /**
   * 请求一次视口范围内的静态层重绘
   * @param {Chunk[]} [previousChunks = []] - 视口变化前可见区块
   * @param {{ origin?: { x: number, y: number }, zoom?: number }} [previousViewportState = {}] - 旧视口状态
   */
  requestViewportBaseRender(previousChunks = [], previousViewportState = {}) {
    const currentChunks = this.syncChunkBufferWithViewport();

    if (currentChunks.length > 0 || previousChunks.length > 0) {
      this.baseRenderer?.invalidateChunks?.(currentChunks, previousChunks, {
        previousViewportState,
      });
      return;
    }

    this.baseRenderer?.invalidateViewport();
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
   * 在白板级设备图中运行时挂载 workflow
   * @param {string} path - workflow 路径（相对于显示器根）
   * @param {import("../../tools/tool.js").Tool|import("../../devices-dag/dag.js").SubDAGDefinition} workflow - 要挂载的 workflow 入口
   */
  mountWorkflow(path, workflow) {
    return this.devicesDAG.mountWorkflow(
      joinPath(this.monitorId, path),
      workflow,
    );
  }

  /**
   * 在白板级设备图中运行时卸载 workflow 节点
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
   * 在白板级设备图中添加有向边
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
