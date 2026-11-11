/**
 * @file 视口渲染器
 * @description
 * 在单类内管理静态缓存（OffscreenCanvas）与输出 canvas 的合成渲染。
 * 对外提供 active / cached 两类失效路径，内部调度器、脏区跟踪、时序同步由本类统一管理。
 * @module canvas/viewport-renderer
 * @author Zhou Chenyu
 */

import {
  Renderer,
  normalizeDirtyRectsForScreenUpdate,
} from "./renderer.js";
import { BasicObject } from "../../kernel/objects/basic-obj.js";
import { RectangleRange } from "../../kernel/range/rectangle.js";
import { intersectsRanges } from "../../kernel/range/index.js";
import { DirectedGraph } from "../../kernel/utils/directed-graph.js";
import { ActiveObjectManager } from "../../kernel/board/active-object-manager.js";
import { collectActiveDrawables as _collectActiveDrawables } from "./aom-collect-utils.js";
import { OBJECT_DRAW_STRATEGIES } from "./object-draw-strategies.js";
import { RenderScheduler, createRectangleDirtyRectMerger } from "./render-scheduler.js";
import { TileStore, DEFAULT_TILE_SIZE } from "./tile-cache.js";
import {
  tileBoundaryDevice,
  tileContentOrigin,
  tileLocalDevice,
} from "./tile-grid.js";
import { normalizeCanvasSize } from "./canvas-lifecycle.js";
import {
  createBaseDirtyRectThresholdStrategy,
  createLiveDirtyRectThresholdStrategy,
} from "./dirty-rect-strategy-shared.js";


/**
 * @typedef {Object} ViewportRendererInvalidateActiveOptions
 * @property {Iterable<BasicObject>} [objects=[]] - 待失效的 AOM 对象集合
 */

/**
 * @typedef {Object} ViewportRendererInvalidateCachedOptions
 * @property {Iterable<BasicObject>} [objects=[]] - 待失效的静态对象集合
 * @property {Map<string, RectangleRange>} [previousWorldRects] - 对象进入 AOM 前的世界范围快照
 */

/**
 * tile 缓存相对视口的世界范围外扩比例（单侧）
 * @description
 * 总覆盖为视口的 1.2 倍边长。外扩是内存与平移命中率的交换项：
 * 缓存字节数约等于视口面积乘以 `(1 + 2 × 该值)²`，这里取 0.10 使覆盖面积只多 44%。
 */
const TILE_CACHE_MARGIN_RATIO = 0.1;

/**
 * 缩放预览允许的累计拉伸倍数
 * @description
 * 预览把上一帧位图按缩放比拉伸后合成，拉伸越大越显模糊。
 * 相对快照累计超过该倍数时改为立即重建一帧清晰内容。
 */
const ZOOM_PREVIEW_MAX_SCALE = 2;

/**
 * 判定连续缩放手势的单步最大变化倍数
 * @description
 * 只有单步变化足够小才说明是连续手势（触控板捏合、滚轮缩放这类逐帧小步）。
 * 按键一次缩放一倍属于离散跳变，走预览只会让用户看到一帧发糊的画面，
 * 因此仍按原路径重建。
 */
const ZOOM_PREVIEW_MAX_STEP = 1.25;

/**
 * 缩放停止后触发清晰重建的等待时间（毫秒）
 * @description 手势连续缩放期间不断重置该定时器，停手后才重建。
 */
const ZOOM_PREVIEW_SETTLE_MS = 150;

/**
 * 视口渲染器
 * @description
 * 在一个类内部管理两个 OffscreenCanvas：`#cache`（静态层预渲染缓存）和 `#output`（最终输出 canvas）。
 * 静态图对象（不在 AOM 中的对象）绘制到 #cache；最终帧输出时，将 #cache 内容拷贝到 #output，
 * 再在上面叠画 AOM 中的对象，形成完整的合成输出。
 *
 * @class
 * @extends Renderer
 * @author Zhou Chenyu
 */
class ViewportRenderer extends Renderer {
  /**
   * 静态缓存 canvas
   * @type {OffscreenCanvas}
   * @private
   */
  #cache;

  /**
   * 活动对象管理器
   * @type {ActiveObjectManager | undefined}
   * @private
   */
  #aom;

  /**
   * 上一帧的 AOM drawable 条目缓存
   * @description
   * 用于在对象移动后同时拿到旧屏幕范围与新屏幕范围，避免输出 canvas 残影。
   * 条目额外携带 `drawnRects`：该对象上一次实际绘制时使用的 clip 脏区（跳过帧继承）。
   * 清除覆盖不变量——任一帧实际绘制的像素区域 ⊆ 下一帧清除区域——
   * 由 drawnRects 保证，与渲染留白是否精确无关。
   * @type {Array<{ objectId: string, object: BasicObject, screenRect?: RectangleRange, drawnRects?: RectangleRange[] }>}
   * @private
   */
  #previousAomEntries;

  /**
   * 待刷新的旧几何快照
   * @description 用于在对象尚未经历上一帧 render 时，仍能显式保留变更前的屏幕范围。
   * @type {Map<string, RectangleRange>}
   * @private
   */
  #objectSnapshotRects;

  /**
   * 静态缓存是否需要更新
   * @type {boolean}
   * @private
   */
  #cacheDirty;

  /**
   * 缓存层缩放感知的脏区合并阈值策略
   * @type {(zoom: number) => Record<string, number | undefined>}
   * @private
   */
  #resolveCacheThresholds;

  /**
   * 输出层缩放感知的脏区合并阈值策略
   * @type {(zoom: number) => Record<string, number | undefined>}
   * @private
   */
  #resolveOutputThresholds;

  /**
   * 世界空间 tile 缓存
   * @type {TileStore}
   * @private
   */
  #tileStore;

  /**
   * 是否允许使用 tile 缓存
   * @description 关闭后退回经典缓存路径，用于对照测试与线上兜底。
   * @type {boolean}
   * @private
   */
  #tilesEnabled;

  /**
   * tile 缓存相对视口的外扩比例
   * @type {number}
   * @private
   */
  #tileCacheMargin = TILE_CACHE_MARGIN_RATIO;

  /**
   * 缓存层渲染调度器
   * @type {RenderScheduler}
   * @private
   */
  #cacheScheduler;

  /**
   * 输出层渲染调度器
   * @type {RenderScheduler}
   * @private
   */
  #outputScheduler;

  /**
   * 缩放预览状态
   * @description 非空时输出层直接缩放合成 `snapshot`，跳过缓存与 tile 重建。
   * @type {{ zoom: number, origin: { x: number, y: number }, snapshot: CanvasImageSource } | null}
   * @private
   */
  #zoomPreview;

  /**
   * 缩放预览的清晰重建定时器
   * @type {ReturnType<typeof setTimeout> | null}
   * @private
   */
  #zoomPreviewTimer;

  /**
   * 是否已产出过至少一帧
   * @description 没有可预览的上一帧时不能进入缩放预览。
   * @type {boolean}
   * @private
   */
  #hasRenderedFrame;

  /**
   * 缩放预览的快照画布
   * @type {OffscreenCanvas | null}
   * @private
   */
  #zoomPreviewCanvas;

  /**
   * @param {import("./viewport-core.js").ViewportCore} viewport - 目标视口
   * @param {ActiveObjectManager | undefined} aom - 活动对象管理器
   * @param {{ canvas?: HTMLCanvasElement | OffscreenCanvas | null }} [options = {}] - 初始化选项
   */
  constructor(viewport, aom, options = {}) {
    super(viewport, options);

    this.#aom = aom;
    this.#previousAomEntries = [];
    this.#objectSnapshotRects = new Map();
    this.#cacheDirty = true;
    this.#resolveCacheThresholds = createBaseDirtyRectThresholdStrategy();

    const outputCanvas = this._canvas;
    const width = outputCanvas?.width ?? 0;
    const height = outputCanvas?.height ?? 0;

    this.#cache = new OffscreenCanvas(width, height);
    this.#tileCacheMargin =
      Number.isFinite(options.tileCacheMargin) && options.tileCacheMargin >= 0
        ? options.tileCacheMargin
        : TILE_CACHE_MARGIN_RATIO;
    this.#tileStore = new TileStore({
      tileSize: options.tileSize ?? DEFAULT_TILE_SIZE,
      deviceScale: this._deviceScale,
      maxBytes: options.tileBudgetBytes,
    });
    this.#tilesEnabled = options.tiles !== false;

    this.#zoomPreview = null;
    this.#zoomPreviewTimer = null;
    this.#hasRenderedFrame = false;
    this.#zoomPreviewCanvas = null;

    this.#resolveOutputThresholds = createLiveDirtyRectThresholdStrategy();

    this.#cacheScheduler = new RenderScheduler({
      mergeDirtyRects: this._createDirtyRectMerger(),
      flushHandler: () => this.#cacheFlush(),
    });

    this.#outputScheduler = new RenderScheduler({
      mergeDirtyRects: this.#createOutputDirtyRectMerger(),
      flushHandler: (dirtyRects) => this.#outputFlush(dirtyRects),
    });

    this._scheduler = this.#outputScheduler;
  }

  /**
   * 输出 canvas（最终上屏的位图来源）
   * @type {HTMLCanvasElement | OffscreenCanvas | null}
   */
  get outputCanvas() {
    return this._canvas;
  }

  /**
   * 静态缓存 canvas（调试用）
   * @description 包含当前帧静态层（非 AOM 对象）的预渲染内容。
   * @returns {OffscreenCanvas}
   */
  getStaticCache() {
    return this.#cache;
  }

  /**
   * 更新活动对象管理器引用
   * @param {ActiveObjectManager | undefined} aom - 活动对象管理器
   */
  setActiveObjectManager(aom) {
    this.#aom = aom;
  }

  /**
   * 调整渲染层尺寸
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   * @returns {boolean} 是否发生了尺寸变化
   */
  resize(width, height) {
    const nextWidth = normalizeCanvasSize(width);
    const nextHeight = normalizeCanvasSize(height);

    // 快照尺寸与新画布不匹配，缩放预览必须作废
    this.#exitZoomPreview();

    let resized = false;
    if (super.resize(nextWidth, nextHeight)) {
      resized = true;
    }

    const cacheCanvas = this.#cache;
    // 缓存画布与输出位图同一坐标空间（设备像素），才能在 1:1 拷贝下不失真
    const nextDeviceWidth = normalizeCanvasSize(nextWidth * this._deviceScale);
    const nextDeviceHeight = normalizeCanvasSize(nextHeight * this._deviceScale);
    if (
      cacheCanvas &&
      (cacheCanvas.width !== nextDeviceWidth ||
        cacheCanvas.height !== nextDeviceHeight)
    ) {
      // 尺寸赋值会重置画布内容，缓存自此不再可信
      cacheCanvas.width = nextDeviceWidth;
      cacheCanvas.height = nextDeviceHeight;
      this.#cacheDirty = true;
      resized = true;
    }

    // tile 位图按设备像素分配，倍率变化由 setRasterScale 统一处理，视口尺寸不参与


    return resized;
  }

  /**
   * 获取当前脏区合并阈值
   * @returns {Record<string, number | undefined>}
   * @protected
   */
  _getThresholds() {
    return this.#resolveCacheThresholds(this.viewport?.zoom ?? 1);
  }

  /**
   * 创建输出层脏区合并器
   * @description 使用 live 层策略（更激进的合并阈值），适用于逐帧变化的 AOM 输出层。
   * @returns {(dirtyRects: any[]) => any[]}
   * @private
   */
  #createOutputDirtyRectMerger() {
    return createRectangleDirtyRectMerger({
      getThresholds: () => this.#resolveOutputThresholds(this.viewport?.zoom ?? 1),
      getViewportRect: () => this._getViewportRect(),
    });
  }

  /**
   * 提交一次失效请求到缓存层和输出层调度器
   * @param {any} [rect] - 失效脏区
   * @returns {boolean}
   */
  invalidate(rect) {
    const cacheScheduled = this.#cacheScheduler.invalidate(rect);
    return this.#outputScheduler.invalidate(rect) || cacheScheduled;
  }

  /**
   * 全量清空输出 canvas
   * @protected
   */
  clear() {
    this.#clearCanvas(this._canvas);
  }

  /**
   * 全量清空指定 canvas
   * @param {HTMLCanvasElement | OffscreenCanvas | null} canvas - 目标 canvas
   * @private
   */
  #clearCanvas(canvas) {
    const ctx = canvas?.getContext?.("2d") ?? null;
    if (!canvas || !ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /**
   * 获取区块的世界矩形范围
   * @param {*} chunk - 区块实例
   * @returns {RectangleRange | undefined}
   */
  getChunkWorldRect(chunk) {
    if (!chunk) return undefined;

    const chunkWidth = this.viewport?.chunkWidth ?? 0;
    const chunkHeight = this.viewport?.chunkHeight ?? 0;
    if (chunkWidth <= 0 || chunkHeight <= 0) return undefined;

    return new RectangleRange(
      chunk.x * chunkWidth,
      chunk.y * chunkHeight,
      chunkWidth,
      chunkHeight,
    );
  }

  /**
   * 获取区块的屏幕矩形范围
   * @param {*} chunk - 区块实例
   * @returns {RectangleRange | undefined}
   */
  getChunkScreenRect(chunk) {
    const worldRect = this.getChunkWorldRect(chunk);
    if (!worldRect) return undefined;
    return this.viewport?.worldRectToScreenRect?.(worldRect);
  }

  /**
   * 按指定视口状态获取区块的屏幕矩形范围
   * @param {*} chunk - 区块实例
   * @param {{ origin?: { x: number, y: number }, zoom?: number }} [viewportState = {}] - 视口状态
   * @returns {RectangleRange | undefined}
   */
  getChunkScreenRectWithViewportState(chunk, viewportState = {}) {
    const worldRect = this.getChunkWorldRect(chunk);
    if (!worldRect) return undefined;

    const origin = viewportState.origin ?? this.viewport?.origin;
    const zoom = viewportState.zoom ?? this.viewport?.zoom ?? 1;

    return new RectangleRange(
      (worldRect.left - origin.x) * zoom,
      (worldRect.top - origin.y) * zoom,
      worldRect.width * zoom,
      worldRect.height * zoom,
    );
  }

  /**
   * 解析静态对象实例
   * @param {string} objectId - 对象 id
   * @returns {BasicObject | undefined}
   *
   * @description
   * 对象查找全部走索引（活动对象表、失活层暂存表、已载对象表），与区块数量无关，
   * 因此不需要传入已载区块集合；传入集合只会让每次查找多建一份 O(区块数) 的数组。
   */
  resolveStaticObjectFromChunks(objectId) {
    const objectInstance =
      this.viewport?.board?.activeObjectManager?.findBoardObjectInstance?.(
        objectId,
      ) ?? this.viewport?.board?.getObjectById?.(objectId);

    return objectInstance instanceof BasicObject ? objectInstance : undefined;
  }

  /**
   * 合并当前已加载区块的静态图
   * @param {Iterable<*>} chunks - 当前已加载区块
   * @returns {BasicObject[]}
   */
  mergeStaticGraphs(chunks) {
    const mergedGraph = new DirectedGraph();

    for (const chunk of chunks) {
      const staticGraph = chunk?.objectManager?.staticGraph;
      if (!staticGraph) continue;

      for (const node of staticGraph.getNodes?.() ?? []) {
        if (!mergedGraph.hasNode(node)) {
          mergedGraph.addNodeUnsafe(node);
        }
      }
    }

    for (const chunk of chunks) {
      const staticGraph = chunk?.objectManager?.staticGraph;
      if (!staticGraph) continue;

      for (const node of staticGraph.getNodes?.() ?? []) {
        for (const neighbor of staticGraph.neighborsUnsafe?.(node) ?? []) {
          if (!mergedGraph.hasNode(neighbor)) {
            mergedGraph.addNodeUnsafe(neighbor);
          }
          if (!mergedGraph.hasEdge(node, neighbor)) {
            mergedGraph.addEdgeUnsafe(node, neighbor);
          }
        }
      }
    }

    const drawables = [];
    for (const objectId of mergedGraph.getTopologicalOrder()) {
      const objectInstance = this.resolveStaticObjectFromChunks(objectId);
      if (!(objectInstance instanceof BasicObject)) continue;

      drawables.push(objectInstance);
    }

    return drawables;
  }

  /**
   * 收集当前 viewport 已加载区块中的静态对象
   * @returns {BasicObject[]}
   */
  collectStaticDrawables() {
    const chunks = this.viewport?.chunkLoader?.getLoadedChunks?.() ?? [];
    return this.mergeStaticGraphs(chunks);
  }

  /**
   * 收集不属 AOM 的静态对象（缓存层绘制用）
   * @returns {BasicObject[]}
   * @private
   */
  #collectCacheDrawables() {
    const allDrawables = this.collectStaticDrawables();
    const aom = this.viewport?.board?.activeObjectManager;
    return typeof aom?.has === "function"
      ? allDrawables.filter((obj) => !aom.has(obj.id))
      : allDrawables;
  }

  /**
   * 收集应绘制的 AOM 对象
   * @returns {BasicObject[]}
   */
  collectActiveDrawables() {
    return _collectActiveDrawables(this.#aom);
  }

  /**
   * 获取对象的世界矩形范围
   * @description
   * 先走基类的渲染包围盒快路径：AOM 的范围解析最终也是 `getRange().withPosition()`，
   * 对笔画等同于逐点复制整条路径，不能挡在快路径前面。
   * 只有基类解析不出范围时才回退到 AOM。
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectWorldRect(objectInstance) {
    const resolved = super.getObjectWorldRect(objectInstance);
    if (resolved) return resolved;

    try {
      const worldRange = this.#aom?.getObjectWorldRange?.(objectInstance);
      if (worldRange) return RectangleRange.from(worldRange);
    } catch {
      // AOM 范围解析期间对象可能正处于 teardown 中间态，按无范围处理
    }
    return undefined;
  }

  /**
   * 记录对象当前几何快照
   * @param {Iterable<BasicObject>} [objects = []] - 待记录对象集合
   */
  captureObjectSnapshot(objects = []) {
    for (const objectInstance of objects ?? []) {
      if (!(objectInstance instanceof BasicObject)) continue;

      const currentRect = this.getObjectScreenRect(objectInstance);
      if (!currentRect) continue;

      const previousSnapshot = this.#objectSnapshotRects.get(objectInstance.id);
      this.#objectSnapshotRects.set(
        objectInstance.id,
        previousSnapshot ? previousSnapshot.union(currentRect) : currentRect,
      );
    }
  }

  /**
   * 按对象 id 索引 drawable 条目
   * @param {Array<{ objectId: string, object: BasicObject, screenRect?: RectangleRange }>} entries - drawable 条目
   * @returns {Map<number, { objectId: string, object: BasicObject, screenRect?: RectangleRange }>}
   */
  indexDrawableEntries(entries) {
    return new Map(entries.map((entry) => [entry.objectId, entry]));
  }

  /**
   * 失效 AOM 对象对应的屏幕脏区（输出层）
   * @description
   * 仅失效输出 canvas，不动缓存。同时失效对象当前范围 + 快照范围 + 上一次实际绘制区域，
   * 确保对象位移或几何变化时旧像素也会被清理。
   * 上一次实际绘制区域取自条目 `drawnRects`（绘制时的 clip 脏区，
   * 跳过帧继承），而非仅对象自身范围——即使渲染留白不足也不会残留。
   * @param {Iterable<BasicObject>} [objects = []] - 待失效的 AOM 对象集合
   */
  invalidateActiveObjects(objects = []) {
    // 有活动对象在动说明正在绘制，缩放预览的旧帧不再可信
    if (objects?.length > 0) this.#exitZoomPreview();

    const previousEntryIndex = this.indexDrawableEntries(
      this.#previousAomEntries,
    );

    const dirtyRects = Array.from(objects).flatMap((objectInstance) => {
      const rects = [];
      const currentRect = this.getObjectScreenRect(objectInstance);
      const snapshotRect = this.#objectSnapshotRects.get(objectInstance.id);
      const previousEntry = previousEntryIndex.get(objectInstance.id);
      const previousDrawnRects =
        previousEntry?.drawnRects ??
        (previousEntry?.screenRect ? [previousEntry.screenRect] : []);

      if (currentRect) rects.push(currentRect);
      if (snapshotRect) rects.push(snapshotRect);
      rects.push(...previousDrawnRects);

      return rects;
    });

    const targetDirtyRects =
      dirtyRects.length > 0
        ? dirtyRects
        : [
          ...this.createDrawableEntries(this.collectActiveDrawables()),
          ...this.#previousAomEntries,
        ]
          .flatMap((entry) =>
            entry?.drawnRects ?? (entry?.screenRect ? [entry.screenRect] : []),
          )
          .map((rect) => this.normalizeScreenRect(rect))
          .filter(Boolean);

    for (const dirtyRect of targetDirtyRects) {
      this.#outputScheduler.invalidate(dirtyRect);
    }
  }

  /**
   * 失效静态对象对应的屏幕脏区（缓存层 + 输出层）
   * @description
   * 标记缓存脏，同时失效对象当前范围、旧世界范围（若提供）与
   * 对象离开 AOM 前最后一次实际绘制区域（`drawnRects`），
   * 确保 commit / delete 等静态图变更场景下旧像素被完整清理。
   * @param {Iterable<BasicObject>} [objects = []] - 待失效的静态对象集合
   * @param {{ previousWorldRects?: Map<string, RectangleRange> }} [options = {}] - 旧世界范围快照
   * @returns {RectangleRange[]} 实际提交的脏区
   */
  invalidateCachedObjects(objects = [], options = {}) {
    // 静态层内容变化后上一帧不再可信，立即退出预览改为重建
    this.#exitZoomPreview();
    this.#cacheDirty = true;

    const previousWorldRects = options.previousWorldRects ?? new Map();
    const previousEntryIndex = this.indexDrawableEntries(
      this.#previousAomEntries,
    );
    const dirtyRects = [];

    for (const objectInstance of objects ?? []) {
      if (!(objectInstance instanceof BasicObject)) continue;

      const padding = this.getObjectScreenPadding(objectInstance);
      const currentRect = this.getObjectScreenRect(objectInstance);
      const previousWorldRect = previousWorldRects.get(objectInstance.id);
      const previousScreenRect = previousWorldRect
        ? this.viewport?.worldRectToScreenRect?.(previousWorldRect)
        : undefined;
      const previousRect = previousScreenRect
        ? previousScreenRect.inflate(padding)
        : undefined;
      const previousDrawnRects =
        previousEntryIndex.get(objectInstance.id)?.drawnRects ?? [];

      if (currentRect) dirtyRects.push(currentRect);
      if (previousRect) dirtyRects.push(previousRect);
      dirtyRects.push(...previousDrawnRects);
    }

    const normalizedRects = dirtyRects.filter(
      (dirtyRect) => dirtyRect instanceof RectangleRange,
    );

    this.#invalidateTilesForCachedObjects(objects, previousWorldRects);

    for (const dirtyRect of normalizedRects) {
      this.invalidate(dirtyRect);
    }

    return normalizedRects;
  }

  /**
   * 失效区块对应的屏幕脏区（缓存层 + 输出层）
   * @param {Iterable<*>} [chunks = []] - 当前区块集合
   * @param {Iterable<*>} [previousChunks = []] - 变更前区块集合
   * @param {{ previousViewportState?: { origin?: { x: number, y: number }, zoom?: number } }} [options = {}] - 旧视口状态
   */
  invalidateChunks(chunks = [], previousChunks = [], options = {}) {
    const previousViewportState = options.previousViewportState ?? {};

    // 缩放期间走预览：不重建缓存与 tile，只把上一帧按新倍率缩放合成
    if (this.#tryEnterZoomPreview(previousViewportState)) {
      return;
    }

    this.#cacheDirty = true;

    this.#invalidateTilesForChunks(chunks, previousChunks, options);

    const dirtyRectMap = new Map();

    for (const chunk of previousChunks) {
      if (!chunk?.id || dirtyRectMap.has(`prev:${chunk.id}`)) continue;
      const screenRect = this.getChunkScreenRectWithViewportState(
        chunk,
        previousViewportState,
      );
      if (!screenRect) continue;
      dirtyRectMap.set(`prev:${chunk.id}`, screenRect);
    }

    for (const chunk of chunks) {
      if (!chunk?.id || dirtyRectMap.has(`next:${chunk.id}`)) continue;
      const screenRect = this.getChunkScreenRect(chunk);
      if (!screenRect) continue;
      dirtyRectMap.set(`next:${chunk.id}`, screenRect);
    }

    for (const dirtyRect of dirtyRectMap.values()) {
      this.invalidate(dirtyRect);
    }
  }

  /**
   * 在归零变换下对输出上下文执行缓存拷贝
   * @description 封装缓存有效性检查与 save/setTransform/restore 骨架，draw 回调负责具体拷贝。
   * @param {CanvasRenderingContext2D} ctx - 输出 canvas 上下文
   * @param {(ctx: CanvasRenderingContext2D, cacheCanvas: OffscreenCanvas) => void} draw - 拷贝回调
   * @private
   */
  #withCacheCopyContext(ctx, draw) {
    const cacheCanvas = this.#cache;
    if (!ctx || !cacheCanvas) return;
    // 零尺寸缓存（浏览器布局就绪前）跳过：drawImage 对 0×0 画布抛错，resize 后自愈
    if (cacheCanvas.width === 0 || cacheCanvas.height === 0) return;

    ctx.save();
    // 缓存与输出同尺寸同坐标空间，纯位图搬运不叠任何变换
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    draw(ctx, cacheCanvas);
    ctx.restore();
  }

  /**
   * 全量拷贝静态缓存到输出 canvas
   * @description 在 clear → copyCache → render 三步流水线中用作第二步。
   * @param {CanvasRenderingContext2D} ctx - 输出 canvas 上下文
   * @private
   */
  #copyCache(ctx) {
    this.#withCacheCopyContext(ctx, (targetCtx, cacheCanvas) => {
      targetCtx.drawImage(cacheCanvas, 0, 0);
    });
  }

  /**
   * 将脏区对应的缓存区域拷贝到输出 canvas
   * @param {CanvasRenderingContext2D} ctx - 输出 canvas 上下文
   * @param {RectangleRange[]} rects - 脏区集合
   * @private
   */
  #copyCacheRects(ctx, rects) {
    if (!Array.isArray(rects)) return;
    this.#withCacheCopyContext(ctx, (targetCtx, cacheCanvas) => {
      const scale = this._deviceScale ?? 1;
      for (const rect of rects) {
        if (!(rect instanceof RectangleRange)) continue;
        // 源与目标都在设备像素空间
        const left = Math.round(rect.left * scale);
        const top = Math.round(rect.top * scale);
        const width = Math.round(rect.width * scale);
        const height = Math.round(rect.height * scale);
        targetCtx.drawImage(
          cacheCanvas,
          left,
          top,
          width,
          height,
          left,
          top,
          width,
          height,
        );
      }
    });
  }

  /**
   * 取得对象绘制时应使用的预览坐标
   * @description 剔除用的屏幕矩形仍按数据坐标计算，否则提交进缓存时新预览位置与旧脏区不匹配会残影。
   * @param {string} objectId - 对象 id
   * @returns {{ x: number, y: number } | undefined} 预览坐标
   */
  getPreviewRenderPosition(objectId) {
    return this._getPreviewPosition(objectId);
  }

  /**
   * 缩放变更时尝试进入预览路径
   * @description
   * 缩放是连续运动，逐帧重新光栅化全部静态对象会成为主要开销（600 笔画约 17ms）。
   * 预览把上一帧位图按缩放比拉伸合成，单帧成本降到一次 drawImage。
   * 三个条件同时满足才启用：单步变化小（连续手势）、方向为放大（快照覆盖视口）、
   * 相对快照的累计拉伸不超过可接受模糊度。
   * 缩小会露出快照未覆盖的区域，留白比重新光栅化更刺眼，因此直接重建。
   * @param {{ origin?: { x: number, y: number }, zoom?: number }} [previousViewportState={}] - 变更前视口状态
   * @returns {boolean} 是否已接管本次渲染
   * @private
   */
  #tryEnterZoomPreview(previousViewportState = {}) {
    const previousZoom = previousViewportState?.zoom;
    const zoom = this.viewport?.zoom ?? 1;
    if (!Number.isFinite(previousZoom) || previousZoom <= 0 || previousZoom === zoom) {
      return false;
    }
    if (!this.#hasRenderedFrame) return false;

    const current = this.#zoomPreview;
    const baseZoom = current ? current.zoom : previousZoom;
    const accumulatedScale = zoom / baseZoom;
    const stepScale = zoom / previousZoom;

    // 缩小会露出快照未覆盖的区域，整片空白比重绘更刺眼
    if (stepScale < 1 || accumulatedScale < 1) {
      this.#exitZoomPreview();
      return false;
    }
    // 离散跳变（按键一次缩放一倍）不属于连续手势
    if (stepScale > ZOOM_PREVIEW_MAX_STEP) {
      this.#exitZoomPreview();
      return false;
    }
    // 累计拉伸超过可接受模糊度
    if (accumulatedScale > ZOOM_PREVIEW_MAX_SCALE) {
      this.#exitZoomPreview();
      return false;
    }

    if (!current) {
      const snapshot = this.#captureZoomPreviewSnapshot();
      if (!snapshot) return false;
      this.#zoomPreview = {
        zoom: previousZoom,
        origin: {
          x: previousViewportState?.origin?.x ?? 0,
          y: previousViewportState?.origin?.y ?? 0,
        },
        snapshot,
      };
    }

    this.#scheduleZoomPreviewSettle();
    return true;
  }

  /**
   * 拷贝当前输出画布作为预览源
   * @returns {CanvasImageSource | null} 快照，无法拷贝时返回 null
   * @private
   */
  #captureZoomPreviewSnapshot() {
    const source = this._canvas;
    const width = source?.width ?? 0;
    const height = source?.height ?? 0;
    if (!(width > 0) || !(height > 0)) return null;

    if (
      !this.#zoomPreviewCanvas ||
      this.#zoomPreviewCanvas.width !== width ||
      this.#zoomPreviewCanvas.height !== height
    ) {
      this.#zoomPreviewCanvas = new OffscreenCanvas(width, height);
    }

    const ctx = this.#zoomPreviewCanvas.getContext?.("2d");
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0);
    return this.#zoomPreviewCanvas;
  }

  /**
   * 销毁渲染器
   * @description 停掉两个调度器与预览定时器，销毁后不再排帧也不再创建画布。
   * @returns {void}
   */
  destroy() {
    this.#exitZoomPreview();
    this.#cacheScheduler.cancel();
    this.#outputScheduler.cancel();
  }

  /**
   * 结束缩放预览并请求一帧清晰渲染
   * @description
   * 手势结束有两条来源：输入侧显式通知（`force` 刷新、显式 flush），
   * 以及空闲兜底定时器。两者共用本方法，保证行为一致。
   * 无预览在跑时直接返回，不产生额外重建。
   * @returns {boolean} 是否结束了一次进行中的预览
   */
  commitZoomPreview() {
    const hadPreview = this.#zoomPreview !== null;
    this.#exitZoomPreview();
    if (!hadPreview) return false;

    // 按最终倍率重建清晰内容。必须同时失效输出调度器，
    // 否则输出帧不会重绘，画面会停留在拉伸预览上
    this.#cacheDirty = true;
    this.#tileStore.markAllDirty();
    this.invalidateViewport();
    return true;
  }

  /**
   * 重置预览的清晰重建定时器
   * @description 兜底路径：输入源不发结束信号时，停手 150ms 后自动提交预览。
   * @private
   */
  #scheduleZoomPreviewSettle() {
    if (this.#zoomPreviewTimer !== null) {
      clearTimeout(this.#zoomPreviewTimer);
    }
    this.#zoomPreviewTimer = setTimeout(() => {
      this.#zoomPreviewTimer = null;
      if (this.commitZoomPreview()) {
        this.viewport?.markFrameDirty?.();
      }
    }, ZOOM_PREVIEW_SETTLE_MS);
  }

  /**
   * 退出缩放预览
   * @private
   */
  #exitZoomPreview() {
    if (this.#zoomPreviewTimer !== null) {
      clearTimeout(this.#zoomPreviewTimer);
      this.#zoomPreviewTimer = null;
    }
    this.#zoomPreview = null;
  }

  /**
   * 用预览快照渲染输出帧
   * @description 快照按 `zoom / 快照倍率` 拉伸，并按原点差平移，保证世界坐标位置不变。
   * @param {CanvasRenderingContext2D} ctx - 输出画布上下文
   * @private
   */
  #renderZoomPreview(ctx) {
    const preview = this.#zoomPreview;
    if (!preview) return;

    const zoom = this.viewport?.zoom ?? 1;
    const origin = this.viewport?.origin ?? { x: 0, y: 0 };
    const scale = zoom / preview.zoom;
    const offsetX = (preview.origin.x - origin.x) * zoom;
    const offsetY = (preview.origin.y - origin.y) * zoom;
    const snapshotWidth = preview.snapshot?.width ?? 0;
    const snapshotHeight = preview.snapshot?.height ?? 0;

    // 快照与输出都是设备像素位图，拉伸量按设备倍率换算
    const deviceScale = this._deviceScale ?? 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.clear();
    if (snapshotWidth > 0 && snapshotHeight > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        preview.snapshot,
        offsetX * deviceScale,
        offsetY * deviceScale,
        snapshotWidth * scale,
        snapshotHeight * scale,
      );
    }
    ctx.restore();
  }

  /**
   * 当前是否使用世界空间 tile 缓存
   * @description
   * 视口能提供世界矩形时启用。tile 的格子间距随缩放取档，像素内容始终按当前缩放光栅化，
   * 因此任何缩放档位都能用；视口接口不完整时退回经典路径。
   * @returns {boolean}
   * @private
   */
  #useTiles() {
    return (
      this.#tilesEnabled &&
      typeof this.viewport?.getViewportWorldRect === "function"
    );
  }

  /**
   * 按内容变化标记 tile 失效
   * @description
   * 只标记对象当前世界范围与旧世界范围覆盖的 tile。这依赖一条不变式：
   * 对象的着墨范围必须落在 `getRange()` 加 `getRenderPadding()` 之内，
   * 由 `draw-bounds` 测试守住（连接样式与端点样式因此限定在能保证该不变式的取值）。
   * 旧范围一侧同样要标脏，否则对象被拾取或移走后原位置会残留像素；
   * 残留像素叠加 AOM 当帧的绘制时，半透明填充会表现为整片变暗。
   * @param {Iterable<BasicObject>} [objects=[]] - 待失效对象
   * @param {Map<string, RectangleRange>} [previousWorldRects] - 旧世界范围快照
   * @private
   */
  #invalidateTilesForCachedObjects(objects, previousWorldRects) {
    const zoom = this.viewport?.zoom ?? 1;
    for (const objectInstance of objects ?? []) {
      const padding = this.getObjectScreenPadding(objectInstance) / (zoom || 1);
      const currentRect = this.getObjectWorldRect(objectInstance);
      if (currentRect) {
        this.#tileStore.markDirtyWorldRect(currentRect.inflate(padding));
      }
      const previousRect = previousWorldRects?.get?.(objectInstance.id);
      if (previousRect) {
        this.#tileStore.markDirtyWorldRect(previousRect.inflate(padding));
      }
    }
  }

  /**
   * 按区块集合差集标记 tile 失效
   * @description
   * 只处理新加载与已卸载的区块。平移会让同一批区块的屏幕矩形全部变化，
   * 但其世界内容并未改变，若按屏幕脏区标记会导致平移时全部 tile 重建。
   * @param {Iterable<*>} chunks - 当前区块集合
   * @param {Iterable<*>} previousChunks - 变更前区块集合
   * @param {Object} [options={}] - 失效选项
   * @private
   */
  #invalidateTilesForChunks(chunks, previousChunks, options = {}) {
    const current = [...(chunks ?? [])].filter((chunk) => chunk?.id !== undefined);
    const previous = [...(previousChunks ?? [])].filter(
      (chunk) => chunk?.id !== undefined,
    );
    if (current.length === 0 && previous.length === 0) return;

    const currentIds = new Set(current.map((chunk) => chunk.id));
    const previousIds = new Set(previous.map((chunk) => chunk.id));
    if (
      current.length === previous.length &&
      current.every((chunk) => previousIds.has(chunk.id))
    ) {
      return;
    }

    for (const chunk of current) {
      if (previousIds.has(chunk.id)) continue;
      const worldRect = this.getChunkWorldRect(chunk);
      if (worldRect) this.#tileStore.markDirtyWorldRect(worldRect);
    }
    for (const chunk of previous) {
      if (currentIds.has(chunk.id)) continue;
      const worldRect = this.getChunkWorldRect(chunk);
      if (worldRect) this.#tileStore.markDirtyWorldRect(worldRect);
    }
  }

  /**
   * 确保覆盖视口的 tile 已建好且内容最新
   * @description
   * 只重新光栅化脏 tile，返回覆盖缓存范围的 tile 列表。
   * 没有脏 tile 时跳过对象收集与层叠排序，平移帧因此只剩合成成本。
   * 重建范围限制在视口世界矩形内：缓存外扩区里的 tile 不会被绘制
   * （合成按脏区裁剪，脏区必在视口内），留到平移揭示时再建。
   * @returns {Array<import("./tile-cache.js").TileEntry>}
   * @private
   */
  #ensureCleanTiles() {
    const worldRect = this.viewport?.getViewportWorldRect?.();
    if (!worldRect) return [];

    const zoom = this.viewport?.zoom ?? 1;
    const deviceScale = this._deviceScale ?? 1;
    // 像素内容取决于缩放与设备倍率，两者变化会让整片 tile 失效
    this.#tileStore.setRasterScale(zoom, deviceScale);

    const cacheWorldRect = this.#expandWorldRect(
      worldRect,
      this.#tileCacheMargin,
    );
    const tiles = this.#tileStore.ensure(cacheWorldRect);
    const dirtyTiles = tiles.filter(
      (tile) =>
        this.#tileStore.isDirty(tile) && intersectsRanges(tile.worldRect, worldRect),
    );

    if (dirtyTiles.length > 0) {
      // padding 与对象自身相关而与 tile 无关，先算一次，避免 tile 数 × 对象数的重复解析
      const items = this.#collectCacheDrawables().map((objectInstance) => {
        const paddedWorldRect = this.getObjectWorldRect(objectInstance);
        if (!paddedWorldRect) return { object: objectInstance, paddedWorldRect: undefined };
        const padding = this.getObjectScreenPadding(objectInstance) / zoom;
        return {
          object: objectInstance,
          paddedWorldRect: paddedWorldRect.inflate(padding),
        };
      });
      for (const tile of dirtyTiles) {
        this.#renderTile(tile, items);
      }
    }

    this.#tileStore.evictToBudget();
    return tiles;
  }

  /**
   * 按单侧比例外扩世界矩形
   * @param {RectangleRange} worldRect - 原世界矩形
   * @param {number} ratio - 单侧外扩比例
   * @returns {RectangleRange}
   * @private
   */
  #expandWorldRect(worldRect, ratio) {
    const marginX = worldRect.width * ratio;
    const marginY = worldRect.height * ratio;
    return new RectangleRange(
      worldRect.left - marginX,
      worldRect.top - marginY,
      worldRect.width + marginX * 2,
      worldRect.height + marginY * 2,
    );
  }

  /**
   * 重新光栅化单块 tile
   * @description
   * tile 上下文以 tile 世界原点为视口原点，对象按全局层叠顺序绘制并裁剪到 tile 内。
   * 每个 tile 都重画所有与之相交的对象，跨 tile 对象的过绘是保持层叠正确的代价。
   * @param {import("./tile-cache.js").TileEntry} tile - 目标 tile
   * @param {Array<{object: BasicObject, paddedWorldRect?: RectangleRange}>} items - 按层叠顺序排列的静态对象，已含外扩范围
   * @returns {RectangleRange[]} 本次重建覆盖的 tile 内矩形
   * @private
   */
  #renderTile(tile, items) {
    const ctx = tile.canvas?.getContext?.("2d") ?? null;
    if (!ctx) {
      this.#tileStore.markRebuilt(tile);
      return [];
    }

    const zoom = this.viewport?.zoom ?? 1;
    const deviceScale = this._deviceScale ?? 1;
    const cssWidth = tile.deviceRect.width / deviceScale;
    const cssHeight = tile.deviceRect.height / deviceScale;
    const fullRect = new RectangleRange(0, 0, cssWidth, cssHeight);

    // 内容原点只由块边界决定，与视口原点无关，因此平移不需要重新光栅化
    const viewportContext = this.createViewportContext(ctx, {
      zoom,
      origin: {
        x: tileContentOrigin(tile.boundaryLeft, zoom, deviceScale),
        y: tileContentOrigin(tile.boundaryTop, zoom, deviceScale),
      },
    });

    const entries = [];
    for (const item of items) {
      const objectInstance = item.object;
      const worldRect = item.paddedWorldRect;
      if (!worldRect) {
        entries.push({ objectId: objectInstance.id, object: objectInstance });
        continue;
      }
      if (!intersectsRanges(worldRect, tile.worldRect)) continue;

      const left =
        tileLocalDevice(
          worldRect.left,
          tile.boundaryLeft,
          zoom,
          deviceScale,
        ) / deviceScale;
      const top =
        tileLocalDevice(worldRect.top, tile.boundaryTop, zoom, deviceScale) /
        deviceScale;
      entries.push({
        objectId: objectInstance.id,
        object: objectInstance,
        screenRect: new RectangleRange(
          left,
          top,
          (worldRect.width * zoom * deviceScale) / deviceScale,
          (worldRect.height * zoom * deviceScale) / deviceScale,
        ),
      });
    }

    if (tile.dirty) {
      this.clearRegion(ctx, fullRect);
      this.renderRegion(ctx, viewportContext, entries, fullRect);
      this.#tileStore.markRebuilt(tile);
      return [fullRect];
    }

    // 局部脏区只重绘 tile 内的小块，其余像素保持不动
    const rebuiltRects = [];
    for (const worldRect of tile.dirtyRects) {
      const localRect = this.#worldRectToTileRect(worldRect, tile);
      if (!localRect) continue;
      this.clearRegion(ctx, localRect);
      this.renderRegion(ctx, viewportContext, entries, localRect);
      rebuiltRects.push(localRect);
    }
    this.#tileStore.markRebuilt(tile);
    return rebuiltRects;
  }

  /**
   * 把世界矩形换算成 tile 内的像素矩形并裁剪到 tile 边界
   * @param {RectangleRange} worldRect - 世界矩形
   * @param {import("./tile-cache.js").TileEntry} tile - 目标 tile
   * @param {number} zoom - 当前缩放
   * @returns {RectangleRange | undefined} tile 内矩形，完全在外时返回 undefined
   * @private
   */
  #worldRectToTileRect(worldRect, tile) {
    const zoom = this.viewport?.zoom ?? 1;
    const deviceScale = this._deviceScale ?? 1;
    const cssWidth = tile.deviceRect.width / deviceScale;
    const cssHeight = tile.deviceRect.height / deviceScale;
    const left = Math.max(
      0,
      tileLocalDevice(worldRect.left, tile.boundaryLeft, zoom, deviceScale) /
        deviceScale,
    );
    const top = Math.max(
      0,
      tileLocalDevice(worldRect.top, tile.boundaryTop, zoom, deviceScale) /
        deviceScale,
    );
    const right = Math.min(
      cssWidth,
      tileLocalDevice(worldRect.right, tile.boundaryLeft, zoom, deviceScale) /
        deviceScale,
    );
    const bottom = Math.min(
      cssHeight,
      tileLocalDevice(worldRect.bottom, tile.boundaryTop, zoom, deviceScale) /
        deviceScale,
    );
    if (right <= left || bottom <= top) return undefined;
    return new RectangleRange(left, top, right - left, bottom - top);
  }

  /**
   * 把 tile 直接合成到目标上下文
   * @description
   * 不再经过静态缓存画布，平移省一次全屏拷贝、提交省一次增量拷贝。
   * 给定脏区时逐区裁剪，只画与该脏区相交的 tile；否则画出视口内全部 tile。
   * @param {CanvasRenderingContext2D} ctx - 目标上下文
   * @param {RectangleRange[]} [dirtyRects=[]] - 屏幕脏区
   * @returns {boolean} 是否完成合成，false 表示视口信息不足需回退缓存拷贝
   * @private
   */
  #drawTiles(ctx, dirtyRects = []) {
    const viewportWorldRect = this.viewport?.getViewportWorldRect?.();
    if (!viewportWorldRect) return false;

    const tiles = this.#ensureCleanTiles();
    const zoom = this.viewport?.zoom ?? 1;
    const origin = this.viewport?.origin ?? { x: 0, y: 0 };
    const deviceScale = this._deviceScale ?? 1;
    // 原点已吸附到整数设备像素，因此贴图位置全是整数，搬运不需要重采样
    const originDeviceX = origin.x * zoom * deviceScale;
    const originDeviceY = origin.y * zoom * deviceScale;
    const viewportRect = this._getViewportRect();

    const toDeviceClip = (rect) => ({
      left: rect.left * deviceScale,
      top: rect.top * deviceScale,
      right: (rect.left + rect.width) * deviceScale,
      bottom: (rect.top + rect.height) * deviceScale,
    });
    const clipRects =
      dirtyRects.length > 0
        ? dirtyRects.map(toDeviceClip)
        : viewportRect
          ? [toDeviceClip(viewportRect)]
          : [null];

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const clipRect of clipRects) {
      for (const tile of tiles) {
        const destLeft = tile.boundaryLeft - originDeviceX;
        const destTop = tile.boundaryTop - originDeviceY;
        const tileWidth = tile.deviceRect.width;
        const tileHeight = tile.deviceRect.height;
        if (
          clipRect &&
          (destLeft >= clipRect.right ||
            destTop >= clipRect.bottom ||
            destLeft + tileWidth <= clipRect.left ||
            destTop + tileHeight <= clipRect.top)
        ) {
          continue;
        }

        this.#tileStore.touch(tile);
        // 只搬限定区内那一块：以整图配小裁剪区会把像素搬运量放大数十倍
        const sourceLeft = clipRect
          ? Math.max(0, Math.round(clipRect.left) - destLeft)
          : 0;
        const sourceTop = clipRect
          ? Math.max(0, Math.round(clipRect.top) - destTop)
          : 0;
        const sourceRight = clipRect
          ? Math.min(tileWidth, Math.round(clipRect.right) - destLeft)
          : tileWidth;
        const sourceBottom = clipRect
          ? Math.min(tileHeight, Math.round(clipRect.bottom) - destTop)
          : tileHeight;
        const sourceWidth = sourceRight - sourceLeft;
        const sourceHeight = sourceBottom - sourceTop;
        if (sourceWidth <= 0 || sourceHeight <= 0) continue;

        ctx.drawImage(
          tile.canvas,
          sourceLeft,
          sourceTop,
          sourceWidth,
          sourceHeight,
          destLeft + sourceLeft,
          destTop + sourceTop,
          sourceWidth,
          sourceHeight,
        );
      }
    }
    ctx.restore();
    return true;
  }

  /**
   * 单块 tile 的位图边长（设备像素）
   * @returns {number} 位图边长
   */
  getTileBitmapSize() {
    return this.#tileStore.bitmapSize;
  }

  /**
   * 读取 tile 缓存调试信息
   * @returns {{ enabled: boolean, tileSize: number, tileCount: number, dirtyCount: number, rebuildCount: number, bytes: number, level: number, zoom: number }}
   */
  getTileDebugInfo() {
    return {
      enabled: this.#useTiles(),
      tileSize: this.#tileStore.tileSize,
      tileCount: this.#tileStore.size,
      dirtyCount: this.#tileStore.countDirty(),
      rebuildCount: this.#tileStore.rebuildCount,
      bytes: this.#tileStore.usedBytes,
      level: this.#tileStore.level,
      zoom: this.#tileStore.zoom,
    };
  }

  /**
   * 更新静态缓存
   * @description
   * 缩放档位 0 走 tile 重建，其余档位全量重建。
   * 局部重建已删除：它依赖一串隐含前提（对象实际绘制范围必须被失效矩形完整覆盖、
   * 退出 AOM 的对象必须当帧被纳入静态失效），任何一条不成立就会残留过期像素，
   * 而实测全量重建的代价与局部重建持平。
   * @private
   */
  #updateCache() {
    const ctx = this.#cache?.getContext?.("2d") ?? null;
    if (!ctx) return;

    if (this.#useTiles() && this.viewport?.getViewportWorldRect?.()) {
      this.#ensureCleanTiles();
      this.#cacheDirty = false;
      return;
    }

    const drawables = this.#collectCacheDrawables();
    const drawableEntries = this.createDrawableEntries(drawables);
    this.#rebuildWholeCache(ctx, drawableEntries);
    this.#cacheDirty = false;
  }

  /**
   * 全量重建静态缓存
   * @param {CanvasRenderingContext2D} ctx - 缓存上下文
   * @param {Array<{screenRect?: RectangleRange, object: BasicObject}>} entries - 静态对象条目
   * @private
   */
  #rebuildWholeCache(ctx, entries) {
    const viewportContext = this.createViewportContext(ctx);
    this.#clearCanvas(this.#cache);

    for (const entry of entries) {
      if (!OBJECT_DRAW_STRATEGIES.has(entry.object.constructor)) continue;
      this.drawObjectWithPreview(viewportContext, entry.object);
    }
  }

  /**
   * 缓存调度器 flush 处理器
   * @description 由缓存层调度器在 rAF 中触发。仅在 `#cacheDirty` 为真时更新缓存。
   * @private
   */
  #cacheFlush() {
    if (this.#cacheDirty) {
      this.#updateCache();
      this.#cacheDirty = false;
    }
  }

  /**
   * 刷新缓存层
   * @description 若缓存脏且有积压脏区，同步刷新缓存。在输出层 flush 前调用，确保缓存不落后于输出。
   * @private
   */
  #flushCacheScheduler() {
    if (!this.#cacheDirty) return;
    if (this.#cacheScheduler.dirtyRects.length > 0) {
      this.#cacheScheduler.flush();
      return;
    }
    // 无积压脏区但缓存脏 → 全量重建
    this.#updateCache();
    this.#cacheDirty = false;
  }

  /**
   * 输出调度器 flush 处理器
   * @description 由输出层调度器在 rAF 中触发。先刷新缓存层（如需要），再渲染输出帧。
   * @param {RectangleRange[]} outputDirtyRects - 输出层脏区集合
   * @returns {BasicObject[]} 当前渲染的 AOM 对象集合
   * @private
   */
  #outputFlush(outputDirtyRects) {
    this.#flushCacheScheduler();
    return this.#renderOutput(outputDirtyRects);
  }

  /**
   * 渲染输出帧
   * @description
   * 输出层渲染管线：脏区清空 + 脏区缓存拷贝 + 脏区裁剪 AOM 绘制。
   * 保留脏区清空/拷贝逻辑，避免全量 clear 在缓存不完整时把旧像素也抹掉。
   * 1. 按脏区清空输出 canvas
   * 2. 按脏区从缓存拷贝静态内容到输出
   * 3. 按脏区裁剪绘制 AOM 对象（不相交则跳过）
   * 4. 保存状态供下一帧使用
   *
   * 每个实际绘制的条目记录 `drawnRects`（本次使用的 clip 脏区，
   * 全量帧退化为对象自身范围），作为下一帧失效时的「上一次实际绘制区域」；
   * 因不相交而跳过的条目从上一帧同 id 条目继承 `drawnRects`——
   * 其像素仍停留在 canvas 上，必须保留清除依据。
   * @param {Array<RectangleRange>} [dirtyRects] - 可选的屏幕脏区集合
   * @returns {BasicObject[]} 当前渲染的 AOM 对象集合
   * @private
   */
  #renderOutput(dirtyRects) {
    const outputCtx = this._getContext();
    if (!outputCtx) return [];

    // 缩放预览直接缩放合成上一帧，跳过缓存拷贝与 AOM 重绘
    if (this.#zoomPreview) {
      this.#renderZoomPreview(outputCtx);
      return [];
    }

    this.#hasRenderedFrame = true;

    const aomDrawables = this.collectActiveDrawables();
    const drawableEntries = this.createDrawableEntries(aomDrawables);
    const previousEntryIndex = this.indexDrawableEntries(
      this.#previousAomEntries,
    );
    const viewportContext = this.createViewportContext(outputCtx);
    const hasExplicitDirtyRects =
      Array.isArray(dirtyRects) && dirtyRects.length > 0;

    // 脏区归一化并扩边到整数边界，确保 clearRect / drawImage 使用一致的 rect
    const normalizedDirtyRects = hasExplicitDirtyRects
      ? normalizeDirtyRectsForScreenUpdate(
        this.collectDirtyRects(dirtyRects),
      )
      : [];

    // 按脏区清空输出 canvas（无脏区时全量清空）
    if (normalizedDirtyRects.length > 0) {
      this.clearDirtyRects(normalizedDirtyRects);
    } else {
      this.clear();
    }

    // 静态内容上屏：tile 模式直接合成到输出，其余模式从缓存画布拷贝
    const tilesDrawn =
      this.#useTiles() && this.#drawTiles(outputCtx, normalizedDirtyRects);
    if (!tilesDrawn) {
      if (normalizedDirtyRects.length > 0) {
        this.#copyCacheRects(outputCtx, normalizedDirtyRects);
      } else {
        this.#copyCache(outputCtx);
      }
    }

    // 按脏区裁剪绘制 AOM 对象：不相交则跳过，相交则裁剪到对应脏区
    for (const entry of drawableEntries) {
      if (!OBJECT_DRAW_STRATEGIES.get(entry.object.constructor)) continue;
      if (
        hasExplicitDirtyRects &&
        !this.intersectsDirtyRects(entry, normalizedDirtyRects)
      ) {
        // 跳过的条目像素仍在 canvas 上，继承上一次实际绘制区域
        const carriedDrawnRects = previousEntryIndex.get(
          entry.objectId,
        )?.drawnRects;
        if (carriedDrawnRects) {
          entry.drawnRects = carriedDrawnRects;
        }
        continue;
      }

      const entryDirtyRects = hasExplicitDirtyRects
        ? this.getEntryDirtyRects(entry, normalizedDirtyRects)
        : [];

      this.renderObjectWithinDirtyRects(
        outputCtx,
        viewportContext,
        entry.object,
        entryDirtyRects,
      );

      entry.drawnRects =
        entryDirtyRects.length > 0
          ? entryDirtyRects
          : (entry.screenRect ? [entry.screenRect] : []);
    }

    // 保存状态供下一帧使用
    this.#previousAomEntries = drawableEntries;
    this.#objectSnapshotRects.clear();

    return aomDrawables;
  }

  /**
   * 刷新输出帧
   * @description
   * 主渲染入口：
   * 1. 刷新缓存层（如需要）
   * 2. 清空输出 canvas 脏区
   * 3. 从缓存拷贝静态内容到输出
   * 4. 绘制 AOM 对象
   * 5. 保存状态供下一帧使用
   * 可直接调用（如测试），也作为输出调度器 flushHandler 的代理。
   * @param {Array<RectangleRange>} [dirtyRects] - 可选的屏幕脏区集合
   * @returns {BasicObject[]} 当前渲染的 AOM 对象集合
   */
  flush(dirtyRects) {
    this.#flushCacheScheduler();
    return this.#renderOutput(dirtyRects);
  }

  /**
   * 将静态缓存内容渲染到外部 canvas（调试用）
   * @param {HTMLCanvasElement | OffscreenCanvas} targetCanvas - 目标 canvas
   * @param {RectangleRange[]} [dirtyRects] - 可选脏区，传入则确保缓存最新
   */
  renderStaticCacheToCanvas(targetCanvas, dirtyRects) {
    if (!targetCanvas) return;

    if (this.#useTiles()) {
      const tileTargetCtx = targetCanvas.getContext?.("2d") ?? null;
      if (!tileTargetCtx) return;
      tileTargetCtx.save();
      tileTargetCtx.setTransform(1, 0, 0, 1, 0, 0);
      tileTargetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      tileTargetCtx.restore();
      this.#drawTiles(tileTargetCtx, []);
      return;
    }

    if (this.#cacheDirty && Array.isArray(dirtyRects)) {
      this.#updateCache();
    }

    const cacheCanvas = this.#cache;
    const targetCtx = targetCanvas.getContext?.("2d") ?? null;
    if (!targetCtx || !cacheCanvas) return;

    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    // 调试目标画布尺寸由调用方决定，显式给出目标尺寸避免高位图下只画出左上角
    targetCtx.drawImage(
      cacheCanvas,
      0,
      0,
      targetCanvas.width,
      targetCanvas.height,
    );
    targetCtx.restore();
  }
}

export { ViewportRenderer };
