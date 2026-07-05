/**
 * @file Worker 侧显示器核心
 * @description
 * MonitorCore 承载 Worker 侧的视口状态、chunk buffer 与 base/live 渲染器。
 * 它不依赖 DOM，仅通过 OffscreenCanvas 渲染并产出可回传到 UI 的帧数据。
 * @module core/components/orchestration/monitor-core
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../../range/index.js";
import { Vector } from "../../utils/math.js";
import { Chunk } from "../chunk/chunk.js";
import { CHUNK_LOAD_STRATEGIES, ChunkLoader } from "../chunk/chunk-loader.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";
import { BaseRenderer } from "../renderer/base-renderer.js";
import { LiveRenderer } from "../renderer/live-renderer.js";
import { BoardCore } from "./board-core.js";

/**
 * Worker 侧显示器核心
 * @class
 * @description
 * 持有 Worker 内的视口状态副本、区块加载器和 OffscreenCanvas 渲染器。
 * UI 侧通过 viewport-change / request-render-flush 驱动它更新与产出帧。
 * @author Zhou Chenyu
 */
class MonitorCore {
  /**
   * 所属 BoardCore
   * @type {BoardCore}
   * @private
   */
  #boardCore;

  /**
   * 显示器 id
   * @type {string | number}
   * @private
   */
  #monitorId;

  /**
   * 当前视口绑定的 ChunkLoader
   * @type {ChunkLoader}
   * @private
   */
  #chunkLoader;

  /**
   * 静态层渲染器
   * @type {BaseRenderer}
   * @private
   */
  #baseRenderer;

  /**
   * 动态层渲染器
   * @type {LiveRenderer}
   * @private
   */
  #liveRenderer;

  /**
   * 当前视口原点
   * @type {Vector}
   * @private
   */
  #origin;

  /**
   * 当前缩放因子
   * @type {number}
   * @private
   */
  #zoom;

  /**
   * 当前视口宽度
   * @type {number}
   * @private
   */
  #width;

  /**
   * 当前视口高度
   * @type {number}
   * @private
   */
  #height;

  /**
   * 已输出帧序号
   * @type {number}
   * @private
   */
  #frameId;

  /**
   * 当前是否存在待回传给 UI 的新帧
   * @type {boolean}
   * @private
   */
  #frameDirty;

  /**
   * 渲染帧回传回调
   * @type {(message: Object, transferList?: Transferable[]) => void}
   * @private
   */
  #postRenderFrame;

  /**
   * @param {{
   *   boardCore: BoardCore,
   *   monitorId: string | number,
   *   width: number,
   *   height: number,
   *   postRenderFrame?: (message: Object, transferList?: Transferable[]) => void,
   * }} options - MonitorCore 初始化选项
   */
  constructor(options) {
    if (!(options?.boardCore instanceof BoardCore)) {
      throw new TypeError("MonitorCore requires a BoardCore instance.");
    }

    this.#boardCore = options.boardCore;
    this.#monitorId = options.monitorId;
    this.#width = Number.isFinite(options.width) ? options.width : 0;
    this.#height = Number.isFinite(options.height) ? options.height : 0;
    this.#zoom = 1;
    this.#origin = new Vector(0, 0);
    this.#frameId = 0;
    this.#frameDirty = false;
    this.#postRenderFrame = options.postRenderFrame ?? (() => {});
    this.#chunkLoader = this.#boardCore.createChunkLoader(
      `monitor-${String(this.#monitorId)}`,
    );

    const baseCanvas = new OffscreenCanvas(this.#width, this.#height);
    const liveCanvas = new OffscreenCanvas(this.#width, this.#height);

    this.#baseRenderer = new BaseRenderer(this, {
      canvas: baseCanvas,
    });
    this.#liveRenderer = new LiveRenderer(
      this,
      this.#boardCore.activeObjectManager,
      {
        canvas: liveCanvas,
      },
    );
  }

  /**
   * 所属 BoardCore
   * @type {BoardCore}
   */
  get board() {
    return this.#boardCore;
  }

  /**
   * 显示器 id
   * @type {string | number}
   */
  get monitorId() {
    return this.#monitorId;
  }

  /**
   * 当前绑定的 ChunkLoader
   * @type {ChunkLoader}
   */
  get chunkLoader() {
    return this.#chunkLoader;
  }

  /**
   * 静态层渲染器
   * @type {BaseRenderer}
   */
  get baseRenderer() {
    return this.#baseRenderer;
  }

  /**
   * 动态层渲染器
   * @type {LiveRenderer}
   */
  get liveRenderer() {
    return this.#liveRenderer;
  }

  /**
   * 当前视口原点
   * @type {Vector}
   */
  get origin() {
    return this.#origin;
  }

  /**
   * 当前缩放因子
   * @type {number}
   */
  get zoom() {
    return this.#zoom;
  }

  /**
   * 当前视口宽度
   * @type {number}
   */
  get width() {
    return this.#width;
  }

  /**
   * 当前视口高度
   * @type {number}
   */
  get height() {
    return this.#height;
  }

  /**
   * 当前区块宽（取自 BoardCore）
   * @type {number}
   */
  get chunkWidth() {
    return this.#boardCore?.width ?? 0;
  }

  /**
   * 当前区块高（取自 BoardCore）
   * @type {number}
   */
  get chunkHeight() {
    return this.#boardCore?.height ?? 0;
  }

  /**
   * 标记当前存在待回传的新帧
   */
  markFrameDirty() {
    this.#frameDirty = true;
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
   * @param {Vector} [origin=this.origin] - 视口原点
   * @param {number} [zoom=this.zoom] - 缩放因子
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
   * @param {Vector} [origin=this.origin] - 视口原点
   * @param {number} [zoom=this.zoom] - 缩放因子
   * @returns {import("../chunk/chunk.js").Chunk[]}
   */
  getVisibleChunksForViewport(origin = this.origin, zoom = this.zoom) {
    if (
      !(this.#boardCore instanceof BoardCore) ||
      this.chunkWidth <= 0 ||
      this.chunkHeight <= 0
    ) {
      return [];
    }

    const viewportWorldRect = this.getViewportWorldRect(origin, zoom);
    const chunkIds = ChunkObjectManager.calculateCoveredChunkIdsForRange(
      viewportWorldRect,
      this.chunkWidth,
      this.chunkHeight,
    );

    return [...chunkIds]
      .map((chunkId) => this.#boardCore.getChunkById?.(chunkId))
      .filter(Boolean);
  }

  /**
   * 以当前视口参数将屏幕点映射到世界坐标
   * @param {Vector | {x:number, y:number}} screenPoint - 屏幕坐标
   * @param {Vector} [origin=this.origin] - 视口原点
   * @param {number} [zoom=this.zoom] - 缩放因子
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
   * 将世界矩形范围映射到屏幕矩形范围
   * @param {RectangleRange | { left: number, top: number, width: number, height: number }} rect - 世界矩形
   * @param {number} [padding=0] - 额外屏幕像素留白
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
   * 将世界坐标映射到区块空间坐标
   * @param {Vector | {x:number, y:number}} worldPoint - 世界坐标
   * @returns {{ chunkId: number, x: number, y: number } | null}
   */
  worldToChunk(worldPoint) {
    if (!(this.#boardCore instanceof BoardCore) || !worldPoint) return null;

    const chunkWidth = this.chunkWidth;
    const chunkHeight = this.chunkHeight;
    if (chunkWidth <= 0 || chunkHeight <= 0) return null;

    const normalizedPoint =
      worldPoint instanceof Vector
        ? worldPoint
        : new Vector(worldPoint?.x ?? 0, worldPoint?.y ?? 0);
    const chunkX = Math.floor(normalizedPoint.x / chunkWidth);
    const chunkY = Math.floor(normalizedPoint.y / chunkHeight);
    const chunkId = Chunk.coordinateToId(chunkX, chunkY);

    return {
      chunkId,
      x: normalizedPoint.x - chunkX * chunkWidth,
      y: normalizedPoint.y - chunkY * chunkHeight,
    };
  }

  /**
   * 使 chunkLoader 覆盖 2x 视口的加载区域
   * @description 加载区 = 视口世界矩形向四周各扩展 50%。
   * @param {Vector} [origin=this.origin] - 视口原点
   * @param {number} [zoom=this.zoom] - 缩放因子
   * @returns {import("../chunk/chunk.js").Chunk[]} 当前视口可见区块
   */
  syncChunkBufferWithViewport(origin = this.origin, zoom = this.zoom) {
    const chunkWidth = this.chunkWidth;
    const chunkHeight = this.chunkHeight;
    if (chunkWidth <= 0 || chunkHeight <= 0) return [];

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

    const loadedChunks = this.#chunkLoader?.getLoadedChunks?.() ?? [];
    const loadedChunkIds = new Set(loadedChunks.map((chunk) => chunk.id));

    for (const chunkId of targetChunkIds) {
      if (loadedChunkIds.has(chunkId)) continue;
      const chunk = this.#chunkLoader?.getChunkById?.(chunkId);
      if (chunk) {
        this.#chunkLoader?.emitLoadRequest?.(chunk, {
          strategy: CHUNK_LOAD_STRATEGIES.FULL,
        });
      }
    }

    const shouldPreserve =
      typeof this.#boardCore.isPersistent === "function"
        ? !this.#boardCore.isPersistent()
        : false;

    if (!shouldPreserve) {
      for (const chunk of loadedChunks) {
        if (targetChunkIds.has(chunk.id)) continue;
        this.#chunkLoader?.emitUnloadRequest?.(chunk);
        this.#chunkLoader?.untrackChunkById?.(chunk.id);
      }
    }

    return this.getVisibleChunksForViewport(origin, zoom);
  }

  /**
   * 请求一次视口范围内的活动层补绘
   */
  requestViewportLiveRender() {
    this.markFrameDirty();
    this.#liveRenderer?.invalidateViewport();
  }

  /**
   * 请求一次视口范围内的静态层重绘
   * @param {import("../chunk/chunk.js").Chunk[]} [previousChunks=[]] - 视口变化前可见区块
   * @param {{ origin?: { x: number, y: number }, zoom?: number }} [previousViewportState={}] - 旧视口状态
   */
  requestViewportBaseRender(previousChunks = [], previousViewportState = {}) {
    const currentChunks = this.syncChunkBufferWithViewport();
    this.markFrameDirty();

    if (currentChunks.length > 0 || previousChunks.length > 0) {
      this.#baseRenderer?.invalidateChunks?.(currentChunks, previousChunks, {
        previousViewportState,
      });
      return;
    }

    this.#baseRenderer?.invalidateViewport();
  }

  /**
   * 在渲染层尺寸变化后请求补绘
   */
  requestRenderLayersRefresh() {
    this.requestViewportBaseRender();
    this.requestViewportLiveRender();
  }

  /**
   * 强制刷新当前视口的全屏渲染
   */
  flushViewportRender() {
    const viewportRect = this.getViewportScreenRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;

    this.syncChunkBufferWithViewport();
    this.markFrameDirty();
    this.#baseRenderer?.invalidate(viewportRect);
    this.#liveRenderer?.invalidate(viewportRect);
  }

  /**
   * 调整渲染层尺寸
   * @param {number} width - 新宽度
   * @param {number} height - 新高度
   * @returns {boolean} 是否发生了尺寸变化
   */
  resize(width, height) {
    const nextWidth = Number.isFinite(width) ? width : 0;
    const nextHeight = Number.isFinite(height) ? height : 0;
    this.#width = nextWidth;
    this.#height = nextHeight;

    let resized = false;
    if (this.#baseRenderer?.resize(nextWidth, nextHeight)) resized = true;
    if (this.#liveRenderer?.resize(nextWidth, nextHeight)) resized = true;
    return resized;
  }

  /**
   * 响应 UI 侧的视口变更
   * @param {{
   *   origin?: Vector | { x: number, y: number },
   *   zoom?: number,
   *   viewportSize?: { width?: number, height?: number },
   *   force?: boolean,
   * }} [nextState={}] - 新视口状态
   * @returns {boolean} 是否实际触发了视口更新
   */
  onViewportChange(nextState = {}) {
    const previousChunks = this.getVisibleChunksForViewport();
    const previousViewportState = {
      origin: this.origin,
      zoom: this.zoom,
    };
    const resized = nextState.viewportSize
      ? this.resize(
          nextState.viewportSize?.width,
          nextState.viewportSize?.height,
        )
      : false;
    const forceRefresh = nextState.force === true;
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
    const originUnchanged =
      nextOrigin.x === previousViewportState.origin.x &&
      nextOrigin.y === previousViewportState.origin.y;
    const zoomUnchanged = nextZoom === previousViewportState.zoom;

    this.#origin = nextOrigin;
    this.#zoom = nextZoom;

    if (!forceRefresh && !resized && originUnchanged && zoomUnchanged) {
      return false;
    }

    this.requestViewportBaseRender(previousChunks, previousViewportState);
    this.requestViewportLiveRender();
    return true;
  }

  /**
   * 将刚转出的位图立即画回源 OffscreenCanvas
   * @description
   * `transferToImageBitmap()` 会把当前像素内容转移给 `ImageBitmap`，
   * 之后源 canvas 可能变为新的空底图。
   * 若不立刻恢复，下一帧仅按脏区补绘时就会丢失未命中的旧像素。
   * @param {OffscreenCanvas | null | undefined} canvas - 源 OffscreenCanvas
   * @param {ImageBitmap | null | undefined} bitmap - 刚转出的位图
   * @returns {void}
   * @private
   */
  #restoreTransferredBitmapToCanvas(canvas, bitmap) {
    if (!canvas || !bitmap) {
      return;
    }

    const context = canvas.getContext?.("2d") ?? null;
    if (!context) {
      return;
    }

    context.save?.();
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    context.clearRect?.(0, 0, canvas.width, canvas.height);
    context.drawImage?.(bitmap, 0, 0);
    context.restore?.();
  }

  /**
   * 输出当前渲染帧
   * @description
   * 该方法会在回传位图前主动 flush 当前两个渲染器的待处理脏区，
   * 确保 UI 侧收到的是最新一帧内容。
   * @returns {boolean} 本次是否实际输出了新帧
   */
  flushRenderFrame() {
    if (!this.#frameDirty && this.#frameId > 0) {
      return false;
    }

    if (this.#baseRenderer?._scheduler?.framePending) {
      this.#baseRenderer._scheduler.flush();
    }
    if (this.#liveRenderer?._scheduler?.framePending) {
      this.#liveRenderer._scheduler.flush();
    }

    const baseCanvas = this.#baseRenderer?.canvas;
    const liveCanvas = this.#liveRenderer?.canvas;
    const baseBitmap = baseCanvas?.transferToImageBitmap?.();
    const liveBitmap = liveCanvas?.transferToImageBitmap?.();

    this.#restoreTransferredBitmapToCanvas(baseCanvas, baseBitmap);
    this.#restoreTransferredBitmapToCanvas(liveCanvas, liveBitmap);

    const transferList = [baseBitmap, liveBitmap].filter(Boolean);
    const frameId = ++this.#frameId;

    this.#postRenderFrame(
      {
        type: "render-frame",
        monitorId: this.#monitorId,
        frameId,
        baseBitmap,
        liveBitmap,
      },
      transferList,
    );

    this.#frameDirty = false;
    return true;
  }

  /**
   * 销毁当前 MonitorCore
   */
  destroy() {
    const loadedChunks = this.#chunkLoader?.getLoadedChunks?.() ?? [];
    for (const chunk of loadedChunks) {
      this.#chunkLoader?.emitUnloadRequest?.(chunk);
      this.#chunkLoader?.untrackChunkById?.(chunk.id);
    }

    this.#chunkLoader?.reset?.();
    this.#frameDirty = false;
  }
}

export { MonitorCore };
