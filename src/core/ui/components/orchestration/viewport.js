/**
 * @file UI 侧视口 facade
 * @description
 * Viewport 是 UI 线程的视口 facade，统一管理视口状态、UiRenderer、
 * workflow/overlay 挂载以及与 Worker 侧 ViewportCore 间的渲染帧与视口消息通信。
 * @module core/ui/components/orchestration/viewport
 * @author Zhou Chenyu
 */

import { RectangleRange } from "../../../shared/range/index.js";
import { Vector } from "../../../utils/math.js";
import { joinPath } from "../../../utils/path.js";
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
 * 区块二维坐标转回字形 id（纯数学，不依赖 Chunk 模块）
 * @param {number} x - 区块 x 坐标
 * @param {number} y - 区块 y 坐标
 * @returns {number}
 */
function _coordinateToId(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error("Invalid chunk coordinate.");
  }
  const radius = Math.max(Math.abs(x), Math.abs(y));
  if (radius === 0) return 1;
  const maxId = (2 * radius + 1) ** 2;
  let diff = 0;
  if (y === -radius) {
    diff = radius - x;
  } else if (x === -radius) {
    diff = radius * 2 + (y + radius);
  } else if (y === radius) {
    diff = radius * 4 + (x + radius);
  } else if (x === radius) {
    diff = radius * 6 + (radius - y);
  } else {
    throw new Error("Coordinate is not on a valid spiral ring.");
  }
  return maxId - diff;
}

/**
 * UI 侧视口
 * @class
 * @description
 * Viewport 是 UI 线程的视口 facade，统一管理以下职责：
 * - 本地视口状态（原点、缩放）与坐标变换（screen↔world↔chunk）
 * - 接收 Worker 侧合成的渲染帧，绘制到 DOM canvas
 * - 持有 UiRenderer，管理 UI 覆盖层（overlay）的注册与补绘
 * - 通过 mountSubDAG / mountWorkflow 为当前视口挂载设备图子图
 * - 通过 viewport-change 消息驱动 Worker 侧 ViewportCore 的视口同步
 * @author Zhou Chenyu
 */
class Viewport {
  /**
   * 视口根元素
   * @type {HTMLElement | null}
   */
  rootElement;

  /**
   * 所属 Board facade
   * @type {import("./board.js").Board}
   */
  board;

  /**
   * 视口 id
   * @type {string}
   */
  viewportId;

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
   * 显示层 DOM canvas
   * @type {HTMLCanvasElement | null}
   * @private
   */
  #canvas;

  /**
   * 显示层 2D 上下文
   * @type {CanvasRenderingContext2D | null}
   * @private
   */
  #canvasCtx;

  /**
   * ui 层 DOM canvas
   * @type {HTMLCanvasElement | null}
   * @private
   */
  #uiCanvas;

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
   *   canvas?: HTMLCanvasElement | null,
   *   uiCanvas?: HTMLCanvasElement | null,
   *   worker: { postMessage: Function, addEventListener: Function, removeEventListener: Function },
   * }} htmlElements - 画布元素与 Worker 选项
   * @param {import("./board.js").Board} board - 所属 Board facade
   * @param {{ width: number, height: number }} options - Viewport 尺寸选项
   * @param {string} viewportId - 视口 id
   */
  constructor(
    { rootElement, canvas, uiCanvas, worker },
    board,
    { width, height },
    viewportId,
  ) {
    this.rootElement = rootElement ?? null;
    this.board = board;
    this.viewportId = viewportId;
    this.#worker = worker;
    this.#canvas = canvas ?? null;
    this.#uiCanvas = uiCanvas ?? null;
    this.#canvasCtx = this.#canvas?.getContext?.("2d") ?? null;
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
    this.uiRenderer = new UiRenderer(this, {
      canvas: this.#uiCanvas,
    });

    const liveCanvasRect = this.#canvas?.getBoundingClientRect?.();
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
   * 当前视口画布宽度
   * @type {number}
   */
  get width() {
    return this.canvas?.width ?? this.#width ?? 0;
  }

  /**
   * 当前视口画布高度
   * @type {number}
   */
  get height() {
    return this.canvas?.height ?? this.#height ?? 0;
  }

  /**
   * 当前视口的可见画布（liveCanvas）
   * @type {HTMLCanvasElement | null}
   */
  get canvas() {
    return this.#canvas ?? null;
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
   * @returns {Viewport} 当前实例
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
    resized =
      this.#resizeCanvas(this.#canvas, nextWidth, nextHeight) || resized;
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
   * 批量将信号包中的 position 信号从 canvas 坐标转为世界坐标
   * @description
   * 遍历信号数组，对 type === "position" 且 context.value 存在的信号做坐标变换。
   * 非 position 信号原样透传。
   * @param {Array<{type: string, context?: Object}>} signals - 原始信号列表
   * @returns {Array<{type: string, context?: Object}>} 转换后的信号列表
   */
  convertCanvasSignalsToWorld(signals) {
    return signals.map((signal) => {
      if (signal.type === "position" && signal.context?.value) {
        const raw = signal.context.value;
        return {
          ...signal,
          context: {
            ...signal.context,
            value: {
              x: raw.x / this.zoom + this.origin.x,
              y: raw.y / this.zoom + this.origin.y,
            },
          },
        };
      }
      return signal;
    });
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
    const chunkId = _coordinateToId(chunkX, chunkY);

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
   * @param {string} path - 子图根路径（相对于视口根）
   * @param {import("../../devices-dag/dag.js").SubDAGDefinition} subDAGDefinition - 子图定义
   */
  mountSubDAG(path, subDAGDefinition) {
    return this.devicesDAG.mountSubDAG(this.viewportId, {
      ...subDAGDefinition,
      rootPath: path || subDAGDefinition.rootPath,
    });
  }

  /**
   * 挂载 workflow 并建立边连接
   * @description
   * workflow 挂载在 `workflows/{name}` 路径下。edges 数组定义从其他节点到该 workflow 的有向边，
   * 支持 prefix 子图（边级信号转换）。
   * @param {string} name - workflow 名（挂载路径为 workflows/{name}）
   * @param {import("../../tools/tool.js").Tool|import("../../devices-dag/dag.js").SubDAGDefinition} workflow - workflow 或子图定义
   * @param {Array<{from: string, edge: string, prefix?: Object}>} [edges=[]] - 边列表
   * @returns {import("../../devices-dag/dag-node-edge.js").DevicesDAGNode|import("../../devices-dag/dag-node-edge.js").DevicesDAGNode[]}
   */
  mountWorkflow(name, workflow, edges = []) {
    const path = `workflows/${name}`;
    const workflowPath = joinPath("/", this.viewportId, path);

    const mountedNode = this.devicesDAG.mountWorkflow(workflowPath, workflow);
    const mountedNodes = Array.isArray(mountedNode) ? mountedNode : [mountedNode];

    /**
     * 在已挂载的单源单汇子图中找到汇节点
     * @param {import("../../devices-dag/dag-node-edge.js").DevicesDAGNode[]} nodes
     * @returns {import("../../devices-dag/dag-node-edge.js").DevicesDAGNode|undefined}
     */
    const findPrefixSink = (nodes) => {
      if (nodes.length === 1) return nodes[0];
      return nodes.find((n) => {
        for (const outEdge of n.outEdges.values()) {
          if (nodes.includes(outEdge.target)) return false;
        }
        return true;
      });
    };

    for (const { from, edge, prefix } of edges) {
      const sourcePath = joinPath("/", this.viewportId, from);

      if (prefix) {
        const prefixSubDAG = { ...prefix, rootPath: edge };
        const prefixNodes = this.devicesDAG.mountSubDAG(sourcePath, prefixSubDAG);
        const sinkNode = findPrefixSink(prefixNodes);
        if (sinkNode?.path) {
          this.devicesDAG.addEdge(sinkNode.path, edge, workflowPath);
        }
      } else {
        this.devicesDAG.addEdge(sourcePath, edge, workflowPath);
      }
    }

    return mountedNode;
  }

  /**
   * 卸载 workflow 并移除边连接
   * @param {string} name - workflow 名
   * @param {Array<{from: string, edge: string}>} [edges=[]] - 要移除的边列表
   * @returns {boolean}
   */
  unmountWorkflow(name, edges = []) {
    const workflowPath = joinPath("/", this.viewportId, `workflows/${name}`);

    for (const { from, edge } of edges) {
      this.devicesDAG.removeEdge(joinPath("/", this.viewportId, from), edge);
    }

    return this.devicesDAG.unmountWorkflow(workflowPath, {
      acc: {
        board: this.board,
        boardApi: this.board?.getBoardApi?.(),
        viewport: this,
      },
    });
  }

  /**
   * 在白板级设备图中添加有向边
   * @param {string} fromPath - 源节点路径（相对于视口根）
   * @param {string} edgeName - 边名
   * @param {string} toPath - 目标节点路径（相对于视口根）
   * @returns {import("../../devices-dag/dag.js").DevicesDAGEdge}
   */
  addEdge(fromPath, edgeName, toPath) {
    return this.devicesDAG.addEdge(
      joinPath("/", this.viewportId, fromPath),
      edgeName,
      joinPath("/", this.viewportId, toPath),
    );
  }

  /**
   * 处理来自 Worker 的一帧渲染结果
   * @param {{ viewportId?: string | number, liveBitmap?: ImageBitmap }} frameData - 渲染帧消息
   */
  onRenderFrame(frameData) {
    const { liveBitmap } = frameData ?? {};

    if (liveBitmap && this.#canvasCtx) {
      this.#canvasCtx.clearRect?.(0, 0, this.width, this.height);
      this.#canvasCtx.drawImage(liveBitmap, 0, 0);
      liveBitmap.close?.();
    }

    this.uiRenderer?.invalidateViewport();
  }

  /**
   * 销毁当前 Viewport
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
    this.#canvasCtx?.clearRect?.(0, 0, this.width, this.height);
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
    if (String(message.viewportId) !== String(this.viewportId)) return;

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
        viewportId: this.viewportId,
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
        viewportId: this.viewportId,
      });
      this.#scheduleRenderFlush();
    });
  }
}

export { Viewport };
