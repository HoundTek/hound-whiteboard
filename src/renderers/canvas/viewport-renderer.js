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
import { TileStore } from "./tile-cache.js";
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
 * 脏区覆盖视口面积达到该比例时退化为全量重建
 * @description 局部重建的收益随覆盖面积下降，超过阈值后全量更划算。
 */
const CACHE_FULL_REBUILD_AREA_RATIO = 0.4;

/**
 * tile 缓存相对视口的世界范围外扩比例（单侧）
 * @description 总覆盖为视口的 1.5 倍边长，平移时先命中已缓存的周边 tile。
 */
const TILE_CACHE_MARGIN_RATIO = 0.25;

/**
 * tile 逐出保留范围的外扩比例（单侧）
 * @description 保留范围大于覆盖范围，避免在缓存边界往返平移时反复分配位图。
 */
const TILE_EVICT_MARGIN_RATIO = 0.5;

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
    this.#tileStore = new TileStore({ tileSize: options.tileSize });
    this.#tilesEnabled = options.tiles !== false;

    this.#resolveOutputThresholds = createLiveDirtyRectThresholdStrategy();

    this.#cacheScheduler = new RenderScheduler({
      mergeDirtyRects: this._createDirtyRectMerger(),
      flushHandler: (dirtyRects) => this.#cacheFlush(dirtyRects),
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
    const nextWidth = Number.isFinite(width) ? width : 0;
    const nextHeight = Number.isFinite(height) ? height : 0;

    let resized = false;
    if (super.resize(nextWidth, nextHeight)) {
      resized = true;
    }

    const cacheCanvas = this.#cache;
    if (cacheCanvas && (cacheCanvas.width !== nextWidth || cacheCanvas.height !== nextHeight)) {
      cacheCanvas.width = nextWidth;
      cacheCanvas.height = nextHeight;
      this.#cacheDirty = true;
      resized = true;
    }

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
   * 在当前已加载区块内解析静态对象实例
   * @param {Iterable<*>} chunks - 当前已加载区块
   * @param {string} objectId - 对象 id
   * @returns {BasicObject | undefined}
   */
  resolveStaticObjectFromChunks(chunks, objectId) {
    const loadedChunks = Array.from(chunks).filter(Boolean);
    const candidateChunkIds = loadedChunks
      .map((chunk) => chunk?.id)
      .filter((chunkId) => Number.isInteger(chunkId));

    const objectInstance =
      this.viewport?.board?.activeObjectManager?.findBoardObjectInstance?.(
        objectId,
        candidateChunkIds,
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
      const objectInstance = this.resolveStaticObjectFromChunks(
        chunks,
        objectId,
      );
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
    this.#cacheDirty = true;

    this.#invalidateTilesForChunks(chunks, previousChunks, options);

    const dirtyRectMap = new Map();
    const previousViewportState = options.previousViewportState ?? {};

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
      for (const rect of rects) {
        if (!(rect instanceof RectangleRange)) continue;
        targetCtx.drawImage(
          cacheCanvas,
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          rect.left,
          rect.top,
          rect.width,
          rect.height,
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
   * 按脏区局部重建静态缓存
   * @description
   * 脏区已由调度器合并，相交矩形会被强制合并，因此各区域互不重叠、不会重复光栅化。
   * 每个区域内重画所有与之相交的静态对象以保持层叠顺序，裁剪限定在区域内。
   * @param {CanvasRenderingContext2D} ctx - 缓存上下文
   * @param {Array<{screenRect?: RectangleRange, object: BasicObject}>} entries - 静态对象条目
   * @param {RectangleRange[]} dirtyRects - 屏幕脏区
   * @returns {number} 实际重绘的对象次数
   * @private
   */
  #rebuildCacheRegions(ctx, entries, dirtyRects) {
    const viewportContext = this.createViewportContext(ctx);
    let redrawCount = 0;

    for (const dirtyRect of dirtyRects) {
      const rect = this.normalizeScreenRect(dirtyRect);
      if (!rect) continue;
      this.clearRegion(ctx, rect);
      const intersecting = entries.filter((entry) =>
        this.intersectsDirtyRects(entry, [rect]),
      );
      redrawCount += this.renderRegion(ctx, viewportContext, intersecting, rect);
    }

    return redrawCount;
  }

  /**
   * 当前是否使用世界空间 tile 缓存
   * @description
   * 仅在缩放档位 0（zoom 为 1）且视口能提供世界矩形时启用，其余情况走既有全量/脏区重建。
   * 视口接口不完整时退回经典路径，避免把局部重建退化成全量。
   * @returns {boolean}
   * @private
   */
  #useTiles() {
    return (
      this.#tilesEnabled &&
      (this.viewport?.zoom ?? 1) === 1 &&
      typeof this.viewport?.getViewportWorldRect === "function"
    );
  }

  /**
   * 按内容变化标记对象涉及的 tile 失效
   * @description
   * 覆盖对象当前与旧世界范围，两者之外不需要重绘。
   * 不传对象表示整体失效，对应静态图结构变化等无明确来源的场景。
   * @param {Iterable<BasicObject>} [objects=[]] - 待失效对象
   * @param {Map<string, RectangleRange>} previousWorldRects - 旧世界范围快照
   * @private
   */
  #invalidateTilesForCachedObjects(objects, previousWorldRects) {
    const list = [...(objects ?? [])].filter(
      (objectInstance) => objectInstance instanceof BasicObject,
    );
    if (list.length === 0) {
      this.#tileStore.markAllDirty();
      return;
    }

    const zoom = this.viewport?.zoom ?? 1;
    for (const objectInstance of list) {
      const padding = this.getObjectScreenPadding(objectInstance) / zoom;
      const currentWorldRect = this.getObjectWorldRect(objectInstance);
      if (currentWorldRect) {
        this.#tileStore.markDirtyWorldRect(currentWorldRect.inflate(padding));
      }
      const previousWorldRect = previousWorldRects.get(objectInstance.id);
      if (previousWorldRect) {
        this.#tileStore.markDirtyWorldRect(previousWorldRect.inflate(padding));
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
   * @returns {Array<import("./tile-cache.js").TileEntry>}
   * @private
   */
  #ensureCleanTiles() {
    const worldRect = this.viewport?.getViewportWorldRect?.();
    if (!worldRect) return [];

    const cacheWorldRect = this.#expandWorldRect(
      worldRect,
      TILE_CACHE_MARGIN_RATIO,
    );
    const tiles = this.#tileStore.ensure(cacheWorldRect);
    const dirtyTiles = tiles.filter((tile) => this.#tileStore.isDirty(tile));

    if (dirtyTiles.length > 0) {
      const items = this.#collectCacheDrawables().map((objectInstance) => ({
        object: objectInstance,
        worldRect: this.getObjectWorldRect(objectInstance),
      }));
      for (const tile of dirtyTiles) {
        this.#renderTile(tile, items);
      }
    }

    this.#tileStore.evictOutside(
      this.#expandWorldRect(worldRect, TILE_EVICT_MARGIN_RATIO),
    );
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
   * @param {Array<{object: BasicObject, worldRect?: RectangleRange}>} items - 按层叠顺序排列的静态对象
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
    const tileSize = this.#tileStore.tileSize;
    const fullRect = new RectangleRange(0, 0, tileSize, tileSize);

    const viewportContext = this.createViewportContext(ctx, {
      zoom,
      origin: { x: tile.worldX, y: tile.worldY },
    });

    const entries = [];
    for (const item of items) {
      const objectInstance = item.object;
      if (!item.worldRect) {
        entries.push({ objectId: objectInstance.id, object: objectInstance });
        continue;
      }
      const padding = this.getObjectScreenPadding(objectInstance) / zoom;
      const worldRect = item.worldRect.inflate(padding);
      if (!intersectsRanges(worldRect, tile.worldRect)) continue;

      entries.push({
        objectId: objectInstance.id,
        object: objectInstance,
        screenRect: new RectangleRange(
          (worldRect.left - tile.worldX) * zoom,
          (worldRect.top - tile.worldY) * zoom,
          worldRect.width * zoom,
          worldRect.height * zoom,
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
      const localRect = this.#worldRectToTileRect(worldRect, tile, zoom);
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
  #worldRectToTileRect(worldRect, tile, zoom) {
    const tileSize = this.#tileStore.tileSize;
    const left = Math.max(0, (worldRect.left - tile.worldX) * zoom);
    const top = Math.max(0, (worldRect.top - tile.worldY) * zoom);
    const right = Math.min(tileSize, (worldRect.right - tile.worldX) * zoom);
    const bottom = Math.min(tileSize, (worldRect.bottom - tile.worldY) * zoom);
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
    if (!this.viewport?.getViewportWorldRect?.()) return false;

    const tiles = this.#ensureCleanTiles();
    const zoom = this.viewport?.zoom ?? 1;
    const origin = this.viewport?.origin ?? { x: 0, y: 0 };
    const tileSize = this.#tileStore.tileSize * zoom;
    const hasDirtyRects = dirtyRects.length > 0;
    const clipRects = hasDirtyRects
      ? dirtyRects
      : [this._getViewportRect() ?? null];

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const clipRect of clipRects) {
      if (hasDirtyRects) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(clipRect.left, clipRect.top, clipRect.width, clipRect.height);
        ctx.clip();
      }

      for (const tile of tiles) {
        const left = (tile.worldX - origin.x) * zoom;
        const top = (tile.worldY - origin.y) * zoom;
        if (
          clipRect &&
          (left >= clipRect.right ||
            top >= clipRect.bottom ||
            left + tileSize <= clipRect.left ||
            top + tileSize <= clipRect.top)
        ) {
          continue;
        }
        ctx.drawImage(tile.canvas, left, top, tileSize, tileSize);
      }

      if (hasDirtyRects) ctx.restore();
    }
    ctx.restore();
    return true;
  }

  /**
   * 读取 tile 缓存调试信息
   * @returns {{ enabled: boolean, tileCount: number, dirtyCount: number, rebuildCount: number }}
   */
  getTileDebugInfo() {
    return {
      enabled: this.#useTiles(),
      tileCount: this.#tileStore.size,
      dirtyCount: this.#tileStore.countDirty(),
      rebuildCount: this.#tileStore.rebuildCount,
    };
  }

  /**
   * 更新静态缓存
   * @description
   * 缩放档位 0 走 tile 重建；其余档位有脏区时按脏区局部重建，否则全量重建。
   * @param {RectangleRange[]} dirtyRects - 屏幕脏区集合
   * @private
   */
  #updateCache(dirtyRects) {
    const ctx = this.#cache?.getContext?.("2d") ?? null;
    if (!ctx) return;

    if (this.#useTiles() && this.viewport?.getViewportWorldRect?.()) {
      this.#ensureCleanTiles();
      this.#cacheDirty = false;
      return;
    }

    const drawables = this.#collectCacheDrawables();
    const drawableEntries = this.createDrawableEntries(drawables);

    if (this.#shouldRebuildWholeCache(dirtyRects)) {
      this.#rebuildWholeCache(ctx, drawableEntries);
    } else {
      this.#rebuildCacheRegions(ctx, drawableEntries, dirtyRects);
    }

    this.#cacheDirty = false;
  }

  /**
   * 判断本次缓存重建是否应走全量
   * @param {RectangleRange[]} dirtyRects - 屏幕脏区
   * @returns {boolean}
   * @private
   */
  #shouldRebuildWholeCache(dirtyRects) {
    if (!Array.isArray(dirtyRects) || dirtyRects.length === 0) return true;

    const rects = dirtyRects
      .map((rect) => this.normalizeScreenRect(rect))
      .filter(Boolean);
    if (rects.length === 0) return true;

    const viewportArea = (this.#cache?.width ?? 0) * (this.#cache?.height ?? 0);
    if (!(viewportArea > 0)) return true;

    let coveredArea = 0;
    for (const rect of rects) {
      coveredArea += Math.max(0, rect.width) * Math.max(0, rect.height);
    }
    return coveredArea / viewportArea >= CACHE_FULL_REBUILD_AREA_RATIO;
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
   * @description 由缓存层调度器在 rAF 中触发。仅在 #cacheDirty 为真时更新缓存。
   * @param {RectangleRange[]} cacheDirtyRects - 缓存层脏区集合
   * @private
   */
  #cacheFlush(cacheDirtyRects) {
    if (this.#cacheDirty) {
      this.#updateCache(cacheDirtyRects);
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
    this.#updateCache([]);
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
      this.#updateCache(dirtyRects);
    }

    const cacheCanvas = this.#cache;
    const targetCtx = targetCanvas.getContext?.("2d") ?? null;
    if (!targetCtx || !cacheCanvas) return;

    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.drawImage(cacheCanvas, 0, 0);
    targetCtx.restore();
  }
}

export { ViewportRenderer };
