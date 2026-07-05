/**
 * @file UI 侧显示器代理
 * @description
 * MonitorProxy 是 Worker 模式下的 UI 侧 monitor façade，负责本地视口状态、UiRenderer、
 * workflow/overlay 挂载以及与 Core Worker 间的渲染帧与视口消息通信。
 * @module core/components/orchestration/monitor-proxy
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../../range/index.js";
import { Vector } from "../../utils/math.js";
import { joinPath } from "../../utils/path.js";
import { Chunk } from "../chunk/chunk.js";
import { UiRenderer } from "../renderer/ui-renderer.js";

/**
 * 规整 requestAnimationFrame 宿主
 * @returns {{ request: typeof requestAnimationFrame, cancel: typeof cancelAnimationFrame }}
 */
function resolveAnimationFrameHost() {
  const request =
    globalThis.requestAnimationFrame ??
    ((callback) => globalThis.setTimeout(() => callback(Date.now()), 16));
  const cancel =
    globalThis.cancelAnimationFrame ??
    ((timerId) => globalThis.clearTimeout(timerId));

  return { request, cancel };
}

/**
 * UI 侧显示器代理
 * @class
 * @description
 * 持有 DOM canvas、UiRenderer 与本地视口状态副本。
 * base/live 图层由 Worker 侧渲染后通过 render-frame 消息回传，再由本类合成到 DOM canvas。
 * @author Zhou Chenyu
 */
class MonitorProxy {
  /**
   * 显示器根元素
   * @type {HTMLElement | null}
   */
  rootElement;

  /**
   * 所属 Board façade
   * @type {import("./board.js").Board}
   */
  board;

  /**
   * 显示器 id
   * @type {string}
   */
  monitorId;

  /**
   * UI 覆盖层渲染器
   * @type {UiRenderer}
   */
  uiRenderer;

  /**
   * 当前视口原点
   * @type {Vector}
   * @private
   */
  _origin;

  /**
   * 当前缩放因子
   * @type {number}
   * @private
   */
  _zoom;

  /**
   * Worker 通信端点
   * @type {{ postMessage: Function, addEventListener: Function, removeEventListener: Function }}
   * @private
   */
  #worker;

  /**
   * base 层 DOM canvas
   * @type {HTMLCanvasElement | null}
   * @private
   */
  #baseCanvas;

  /**
   * live 层 DOM canvas
   * @type {HTMLCanvasElement | null}
   * @private
   */
  #liveCanvas;

  /**
   * ui 层 DOM canvas
   * @type {HTMLCanvasElement | null}
   * @private
   */
  #uiCanvas;

  /**
   * base 层 2D 上下文
   * @type {CanvasRenderingContext2D | null}
   * @private
   */
  #baseCtx;

  /**
   * live 层 2D 上下文
   * @type {CanvasRenderingContext2D | null}
   * @private
   */
  #liveCtx;

  /**
   * 当前画布宽度缓存
   * @type {number}
   * @private
   */
  #width;

  /**
   * 当前画布高度缓存
   * @type {number}
   * @private
   */
  #height;

  /**
   * 绑定后的 Worker 消息监听器
   * @type {(event: MessageEvent | { data?: any }) => void}
   * @private
   */
  #workerMessageListener;

  /**
   * 视口同步 rAF id
   * @type {number | ReturnType<typeof setTimeout> | null}
   * @private
   */
  #pendingViewportRafId;

  /**
   * render flush 循环 rAF id
   * @type {number | ReturnType<typeof setTimeout> | null}
   * @private
   */
  #pendingFlushRafId;

  /**
   * render flush 循环是否已启动
   * @type {boolean}
   * @private
   */
  #workerSyncStarted;

  /**
   * 下一次 viewport-change 是否强制刷新
   * @type {boolean}
   * @private
   */
  #pendingViewportForce;

  /**
   * 下一次 viewport-change 是否携带 viewportSize
   * @type {boolean}
   * @private
   */
  #pendingViewportSizeSync;

  /**
   * @param {{
   *   rootElement?: HTMLElement | null,
   *   baseCanvas?: HTMLCanvasElement | null,
   *   liveCanvas?: HTMLCanvasElement | null,
   *   uiCanvas?: HTMLCanvasElement | null,
   *   worker: { postMessage: Function, addEventListener: Function, removeEventListener: Function },
   * }} htmlElements - 画布元素与 Worker 选项
   * @param {import("./board.js").Board} board - 所属 Board façade
   * @param {{ width: number, height: number }} options - Monitor 尺寸选项
   * @param {string} monitorId - 显示器 id
   */
  constructor(
    { rootElement, baseCanvas, liveCanvas, uiCanvas, worker },
    board,
    { width, height },
    monitorId,
  ) {
    this.rootElement = rootElement ?? null;
    this.board = board;
    this.monitorId = monitorId;
    this.#worker = worker;
    this.#baseCanvas = baseCanvas ?? null;
    this.#liveCanvas = liveCanvas ?? null;
    this.#uiCanvas = uiCanvas ?? null;
    this.#baseCtx = this.#baseCanvas?.getContext?.("2d") ?? null;
    this.#liveCtx = this.#liveCanvas?.getContext?.("2d") ?? null;
    this.#width = Number.isFinite(width) ? width : 0;
    this.#height = Number.isFinite(height) ? height : 0;
    this._zoom = 1;
    this.#pendingViewportRafId = null;
    this.#pendingFlushRafId = null;
    this.#workerSyncStarted = false;
    this.#pendingViewportForce = false;
    this.#pendingViewportSizeSync = false;
    this.#workerMessageListener = this.#handleWorkerMessage.bind(this);
    this.#worker.addEventListener("message", this.#workerMessageListener);
    this.uiRenderer = new UiRenderer(this, undefined, {
      canvas: this.#uiCanvas,
    });

    const liveCanvasRect = this.#liveCanvas?.getBoundingClientRect?.();
    const canvasWidth = liveCanvasRect?.width ?? this.#width;
    const canvasHeight = liveCanvasRect?.height ?? this.#height;
    this._origin = new Vector(
      this.chunkWidth / 2 - canvasWidth / (2 * this._zoom),
      this.chunkHeight / 2 - canvasHeight / (2 * this._zoom),
    );
    this.resizeRenderLayers(this.#width, this.#height, { syncWorker: false });
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
    return this.canvas?.width ?? this.#width ?? 0;
  }

  /**
   * 当前显示器画布高度
   * @type {number}
   */
  get height() {
    return this.canvas?.height ?? this.#height ?? 0;
  }

  /**
   * 当前显示器的可见画布（liveCanvas）
   * @type {HTMLCanvasElement | null}
   */
  get canvas() {
    return this.#liveCanvas ?? null;
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
   * 启动与 Worker 的视口同步和渲染 flush 循环
   * @returns {MonitorProxy} 当前实例
   */
  startWorkerSync() {
    if (this.#workerSyncStarted) {
      return this;
    }

    this.#workerSyncStarted = true;
    this.#scheduleViewportSync({ force: true, includeViewportSize: true });
    this.#scheduleRenderFlush();
    return this;
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
   * 统一更新视口状态
   * @param {{ origin?: Vector | {x:number, y:number}, zoom?: number }} [nextState={}] - 新视口状态
   */
  setViewportState(nextState = {}) {
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
    const originChanged =
      nextOrigin.x !== this.origin.x || nextOrigin.y !== this.origin.y;
    const zoomChanged = nextZoom !== this.zoom;

    this._origin = nextOrigin;
    this._zoom = nextZoom;

    if (!originChanged && !zoomChanged) {
      return;
    }

    this.requestViewportUiRender();
    this.#scheduleViewportSync();
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
   * @param {Vector | {x:number, y:number}} [screenAnchor=this.getViewportScreenCenter()] - 屏幕锚点
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
   * 请求一次视口范围内的 UI 层补绘
   */
  requestViewportUiRender() {
    this.uiRenderer?.invalidateViewport();
  }

  /**
   * 强制刷新当前视口的全屏渲染
   */
  flushViewportRender() {
    this.requestViewportUiRender();
    this.#scheduleViewportSync({
      force: true,
      includeViewportSize: true,
    });
  }

  /**
   * 调整所有渲染层尺寸
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   * @param {{ syncWorker?: boolean }} [options={}] - 附加选项
   */
  resizeRenderLayers(width, height, options = {}) {
    const nextWidth = Number.isFinite(width) ? width : 0;
    const nextHeight = Number.isFinite(height) ? height : 0;
    this.#width = nextWidth;
    this.#height = nextHeight;

    let resized = false;
    resized = this.#resizeCanvas(this.#baseCanvas, nextWidth, nextHeight) || resized;
    resized = this.#resizeCanvas(this.#liveCanvas, nextWidth, nextHeight) || resized;
    resized = this.uiRenderer?.resize(nextWidth, nextHeight) || resized;

    if (resized) {
      this.requestRenderLayersRefresh({
        syncWorker: options.syncWorker !== false,
      });
    }
  }

  /**
   * 在渲染层尺寸变化后请求补绘
   * @param {{ syncWorker?: boolean }} [options={}] - 附加选项
   */
  requestRenderLayersRefresh(options = {}) {
    this.requestViewportUiRender();

    if (options.syncWorker !== false) {
      this.#scheduleViewportSync({
        force: true,
        includeViewportSize: true,
      });
    }
  }

  /**
   * 注册 UI overlay provider
   * @param {Function} provider - overlay provider
   * @param {{ invalidate?: boolean }} [options={}] - 附加选项
   * @returns {Function | undefined}
   */
  registerUiOverlayProvider(provider, options = {}) {
    const registeredProvider = this.uiRenderer?.registerOverlayProvider?.(provider);

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
    const removed = this.uiRenderer?.unregisterOverlayProvider?.(provider) ?? false;

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

    return { chunkId, x: chunkLocalX, y: chunkLocalY };
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
      acc: {
        board: this.board,
        boardApi: this.board?.getBoardApi?.(),
        monitor: this,
      },
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

  /**
   * 处理来自 Worker 的一帧渲染结果
   * @param {{ monitorId?: string | number, baseBitmap?: ImageBitmap, liveBitmap?: ImageBitmap }} frameData - 渲染帧消息
   */
  onRenderFrame(frameData) {
    const { baseBitmap, liveBitmap } = frameData ?? {};

    if (baseBitmap && this.#baseCtx) {
      this.#baseCtx.clearRect?.(0, 0, this.width, this.height);
      this.#baseCtx.drawImage(baseBitmap, 0, 0);
      baseBitmap.close?.();
    }
    if (liveBitmap && this.#liveCtx) {
      this.#liveCtx.clearRect?.(0, 0, this.width, this.height);
      this.#liveCtx.drawImage(liveBitmap, 0, 0);
      liveBitmap.close?.();
    }

    this.uiRenderer?.invalidateViewport();
  }

  /**
   * 销毁当前 MonitorProxy
   */
  destroy() {
    const { cancel } = resolveAnimationFrameHost();
    this.#workerSyncStarted = false;

    if (this.#pendingViewportRafId != null) {
      cancel(this.#pendingViewportRafId);
      this.#pendingViewportRafId = null;
    }
    if (this.#pendingFlushRafId != null) {
      cancel(this.#pendingFlushRafId);
      this.#pendingFlushRafId = null;
    }

    this.#worker.removeEventListener("message", this.#workerMessageListener);
    this.#baseCtx?.clearRect?.(0, 0, this.width, this.height);
    this.#liveCtx?.clearRect?.(0, 0, this.width, this.height);
  }

  /**
   * 调整单个 canvas 尺寸
   * @param {HTMLCanvasElement | null} canvas - 目标 canvas
   * @param {number} width - 新宽度
   * @param {number} height - 新高度
   * @returns {boolean} 是否发生了尺寸变化
   * @private
   */
  #resizeCanvas(canvas, width, height) {
    if (!canvas) return false;
    if (canvas.width === width && canvas.height === height) {
      return false;
    }

    canvas.width = width;
    canvas.height = height;
    return true;
  }

  /**
   * 处理 Worker 消息
   * @param {MessageEvent | { data?: any }} event - Worker 消息事件
   * @returns {void}
   * @private
   */
  #handleWorkerMessage(event) {
    const message = event?.data;
    if (!message || typeof message !== "object") return;
    if (message.type !== "render-frame") return;
    if (String(message.monitorId) !== String(this.monitorId)) return;

    this.onRenderFrame(message);
  }

  /**
   * 安排一次 viewport-change 同步
   * @param {{ force?: boolean, includeViewportSize?: boolean }} [options={}] - 同步选项
   * @private
   */
  #scheduleViewportSync(options = {}) {
    const { request, cancel } = resolveAnimationFrameHost();
    this.#pendingViewportForce =
      this.#pendingViewportForce || options.force === true;
    this.#pendingViewportSizeSync =
      this.#pendingViewportSizeSync || options.includeViewportSize === true;

    if (this.#pendingViewportRafId != null) {
      cancel(this.#pendingViewportRafId);
    }

    this.#pendingViewportRafId = request(() => {
      this.#pendingViewportRafId = null;
      if (!this.#workerSyncStarted) {
        this.#pendingViewportForce = false;
        this.#pendingViewportSizeSync = false;
        return;
      }

      const payload = {
        type: "viewport-change",
        monitorId: this.monitorId,
        origin: {
          x: this.origin.x,
          y: this.origin.y,
        },
        zoom: this.zoom,
      };

      if (this.#pendingViewportSizeSync) {
        payload.viewportSize = {
          width: this.width,
          height: this.height,
        };
      }
      if (this.#pendingViewportForce) {
        payload.force = true;
      }

      this.#pendingViewportForce = false;
      this.#pendingViewportSizeSync = false;
      this.#worker.postMessage(payload);
    });
  }

  /**
   * 安排下一帧 render flush 请求
   * @private
   */
  #scheduleRenderFlush() {
    const { request } = resolveAnimationFrameHost();
    this.#pendingFlushRafId = request(() => {
      this.#pendingFlushRafId = null;
      if (!this.#workerSyncStarted) {
        return;
      }

      this.#worker.postMessage({
        type: "request-render-flush",
        monitorId: this.monitorId,
      });
      this.#scheduleRenderFlush();
    });
  }
}

export { MonitorProxy };
