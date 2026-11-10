/**
 * @file Worker 侧视口核心
 * @description
 * ViewportCore 承载 Worker 侧的视口状态、chunk buffer 与 ViewportRenderer。
 * 它不依赖 DOM，仅通过 OffscreenCanvas 渲染并产出可回传到 UI 的帧数据。
 * @module canvas/viewport-core
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../../kernel/range/index.js";
import { Vector } from "../../kernel/utils/math.js";
import { Chunk } from "../../kernel/chunk/chunk.js";
import {
  CHUNK_LOAD_STRATEGIES,
  ChunkLoader,
} from "../../kernel/chunk/chunk-loader.js";
import { ChunkObjectManager } from "../../kernel/chunk/chunk-object-manager.js";
import { ViewportRenderer } from "./viewport-renderer.js";
import { BoardCore } from "../../kernel/board/board-core.js";

/**
 * Worker 侧视口核心
 * @class
 * @description
 * 持有 Worker 内的视口状态副本、区块加载器和 OffscreenCanvas 渲染器。
 * UI 侧通过 viewport-change / request-render-flush 驱动它更新与产出帧。
 * @author Zhou Chenyu
 */
class ViewportCore {
  /**
   * 所属 BoardCore
   * @type {BoardCore}
   * @private
   */
  #boardCore;

  /**
   * 视口 id
   * @type {string | number}
   * @private
   */
  #viewportId;

  /**
   * 当前视口绑定的 ChunkLoader
   * @type {ChunkLoader}
   * @private
   */
  /**
   * 是否启用世界空间 tile 缓存
   * @type {boolean}
   * @private
   */
  #tilesEnabled;

  #chunkLoader;

  /**
   * 视口渲染器
   * @type {ViewportRenderer}
   * @private
   */
  #renderer;

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
   * 帧由净转脏时的通知回调
   * @description 用于让 UI 侧的渲染循环在空闲休眠后被内容变化唤醒，只在跳变时触发一次。
   * @type {() => void}
   * @private
   */
  #onFrameDirty;

  /**
   * @param {{
   *   boardCore: BoardCore,
   *   viewportId: string | number,
   *   width: number,
   *   height: number,
   *   postRenderFrame?: (message: Object, transferList?: Transferable[]) => void,
   *   onFrameDirty?: () => void,
   *   tiles?: boolean,
   * }} options - ViewportCore 初始化选项
   */
  constructor(options) {
    if (!(options?.boardCore instanceof BoardCore)) {
      throw new TypeError("ViewportCore requires a BoardCore instance.");
    }

    this.#boardCore = options.boardCore;
    this.#viewportId = options.viewportId;
    this.#width = Number.isFinite(options.width) ? options.width : 0;
    this.#height = Number.isFinite(options.height) ? options.height : 0;
    this.#zoom = 1;
    this.#origin = new Vector(0, 0);
    this.#frameId = 0;
    this.#frameDirty = false;
    this.#postRenderFrame = options.postRenderFrame ?? (() => {});
    this.#onFrameDirty = options.onFrameDirty ?? (() => {});
    this.#chunkLoader = this.#boardCore.createChunkLoader(
      `viewport-${String(this.#viewportId)}`,
    );

    // tile 开关只在此处归一化一次。
    // 渲染器的启用判定与原点的整数量化必须取同一个值，
    // 否则会出现渲染器开 tile 而原点未量化的错配，
    // 导致合成退化为小数目标坐标，描边相位偏移回归
    this.#tilesEnabled = options.tiles !== false;
    this.#renderer = new ViewportRenderer(
      this,
      this.#boardCore.activeObjectManager,
      {
        canvas: new OffscreenCanvas(this.#width, this.#height),
        tiles: this.#tilesEnabled,
        tileSize: options.tileSize,
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
   * 视口 id
   * @type {string | number}
   */
  get viewportId() {
    return this.#viewportId;
  }

  /**
   * 当前绑定的 ChunkLoader
   * @type {ChunkLoader}
   */
  get chunkLoader() {
    return this.#chunkLoader;
  }

  /**
   * 视口渲染器
   * @type {ViewportRenderer}
   */
  get renderer() {
    return this.#renderer;
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
    return this.#boardCore.width;
  }

  /**
   * 当前区块高（取自 BoardCore）
   * @type {number}
   */
  get chunkHeight() {
    return this.#boardCore.height;
  }

  /**
   * 标记当前存在待回传的新帧
   */
  markFrameDirty() {
    if (!this.#frameDirty) this.#onFrameDirty();
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
   * @returns {import("../../kernel/chunk/chunk.js").Chunk[]}
   */
  getVisibleChunksForViewport(origin = this.origin, zoom = this.zoom) {
    if (this.chunkWidth <= 0 || this.chunkHeight <= 0) {
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
    if (!worldPoint) return null;

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
   * @returns {import("../../kernel/chunk/chunk.js").Chunk[]} 当前视口可见区块
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

    const loadedChunks = this.#chunkLoader.getLoadedChunks();
    const loadedChunkIds = new Set(loadedChunks.map((chunk) => chunk.id));

    for (const chunkId of targetChunkIds) {
      if (loadedChunkIds.has(chunkId)) continue;
      const chunk = this.#chunkLoader.getChunkById(chunkId);
      if (chunk) {
        this.#chunkLoader.emitLoadRequest(chunk, {
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
        this.#chunkLoader.emitUnloadRequest(chunk);
        this.#chunkLoader.untrackChunkById(chunk.id);
      }
    }

    return this.getVisibleChunksForViewport(origin, zoom);
  }

  /**
   * 请求一次视口范围内的活动层补绘
   */
  requestViewportActiveRefresh() {
    this.markFrameDirty();
    this.#renderer?.invalidateViewport();
  }

  /**
   * 请求一次视口范围内的静态缓存刷新
   * @param {import("../../kernel/chunk/chunk.js").Chunk[]} [previousChunks=[]] - 视口变化前可见区块
   * @param {{ origin?: { x: number, y: number }, zoom?: number }} [previousViewportState={}] - 旧视口状态
   */
  requestViewportStaticRefresh(
    previousChunks = [],
    previousViewportState = {},
  ) {
    const currentChunks = this.syncChunkBufferWithViewport();
    this.markFrameDirty();

    if (currentChunks.length > 0 || previousChunks.length > 0) {
      this.#renderer?.invalidateChunks?.(currentChunks, previousChunks, {
        previousViewportState,
      });
      return;
    }

    this.#renderer?.invalidateViewport();
  }

  /**
   * 在渲染层尺寸变化后请求补绘
   */
  requestRenderLayersRefresh() {
    this.requestViewportStaticRefresh();
    this.requestViewportActiveRefresh();
  }

  /**
   * 强制刷新当前视口的全屏渲染
   */
  flushViewportRender() {
    const viewportRect = this.getViewportScreenRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;

    // 显式 flush 等同于「这一帧必须清晰」，结束缩放预览
    this.#renderer?.commitZoomPreview?.();

    this.syncChunkBufferWithViewport();
    this.markFrameDirty();
    this.#renderer?.invalidate(viewportRect);
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
    if (this.#renderer?.resize(nextWidth, nextHeight)) resized = true;
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
    // tile 合成要求整数视口原点：小数目标坐标会被 canvas 实现自行 snap，
    // 导致 tile 内容相对真实世界位置出现亚像素相位偏移（描边粗细两侧不一致）。
    // 缩放档位 0 才走 tile，其余档位保留亚像素平移以获得平滑效果。
    const quantizedOrigin =
      this.#tilesEnabled && nextZoom === 1
        ? new Vector(Math.round(nextOrigin.x), Math.round(nextOrigin.y))
        : nextOrigin;
    // 输入侧显式要求刷新，说明手势已经收尾，缩放预览必须立即换成清晰帧
    if (forceRefresh) {
      this.#renderer?.commitZoomPreview?.();
    }

    const originUnchanged =
      quantizedOrigin.x === previousViewportState.origin.x &&
      quantizedOrigin.y === previousViewportState.origin.y;
    const zoomUnchanged = nextZoom === previousViewportState.zoom;

    this.#origin = quantizedOrigin;
    this.#zoom = nextZoom;

    if (!forceRefresh && !resized && originUnchanged && zoomUnchanged) {
      return false;
    }

    this.requestViewportStaticRefresh(previousChunks, previousViewportState);
    this.requestViewportActiveRefresh();
    return true;
  }

  /**
   * 将刚转出的位图立即画回源 OffscreenCanvas
   * @description
   * `transferToImageBitmap()` 会把当前像素内容转移给 `ImageBitmap`，
   * 之后源 canvas 可能变为新的空底图。
   * 若不立刻恢复，下一帧仅按脏区补绘时就会丢失未命中的旧像素。
   * @param {OffscreenCanvas | HTMLCanvasElement | null | undefined} canvas - 源 canvas
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

    // 零尺寸画布（浏览器布局就绪前）整帧跳过：调度 flush 与 transferToImageBitmap
    // 都会对 0×0 画布抛错；保留 frameDirty，resize 后正常出帧
    const outputCanvas = this.#renderer?.outputCanvas;
    if (
      !outputCanvas ||
      outputCanvas.width === 0 ||
      outputCanvas.height === 0
    ) {
      return false;
    }

    if (this.#renderer?._scheduler?.framePending) {
      this.#renderer._scheduler.flush();
    }

    const liveBitmap = outputCanvas.transferToImageBitmap?.();

    this.#restoreTransferredBitmapToCanvas(outputCanvas, liveBitmap);

    const transferList = liveBitmap ? [liveBitmap] : [];
    const frameId = ++this.#frameId;

    this.#postRenderFrame(
      {
        type: "render-frame",
        viewportId: this.#viewportId,
        frameId,
        liveBitmap,
      },
      transferList,
    );

    this.#frameDirty = false;
    return true;
  }

  /**
   * 销毁当前 ViewportCore
   */
  destroy() {
    this.#chunkLoader.destroy();
    this.#frameDirty = false;
  }
}

export { ViewportCore };
