/**
 * @file 视口渲染器
 * @description
 * 在单类内管理静态缓存（OffscreenCanvas）与输出 canvas 的合成渲染。
 * 对外提供 active / cached 两类失效路径，内部调度器、脏区跟踪、时序同步由本类统一管理。
 * @module core/worker/components/renderer/viewport-renderer
 * @author Zhou Chenyu
 */

import {
  Renderer,
  expandRectForClear,
  normalizeDirtyRectsForScreenUpdate,
} from "../../../shared/renderer/renderer.js";
import { BasicObject } from "../../../shared/objects/basic-obj.js";
import { RectangleRange } from "../../../shared/range/rectangle.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import { ActiveObjectManager } from "../orchestration/active-object-manager.js";
import { collectActiveDrawables as _collectActiveDrawables } from "./aom-collect-utils.js";
import { RenderScheduler, createRectangleDirtyRectMerger } from "../../../shared/renderer/render-scheduler.js";
import {
  createBaseDirtyRectThresholdStrategy,
  createLiveDirtyRectThresholdStrategy,
} from "../../../shared/renderer/dirty-rect-strategy-shared.js";


/**
 * @typedef {Object} ViewportRendererInvalidateActiveOptions
 * @property {Iterable<BasicObject>} [objects=[]] - 待失效的 AOM 对象集合
 */

/**
 * @typedef {Object} ViewportRendererInvalidateCachedOptions
 * @property {Iterable<BasicObject>} [objects=[]] - 待失效的静态对象集合
 * @property {Map<number, RectangleRange>} [previousWorldRects] - 对象进入 AOM 前的世界范围快照
 */

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
   * @description 用于在对象移动后同时拿到旧屏幕范围与新屏幕范围，避免输出 canvas 残影。
   * @type {Array<{ objectId: number, object: BasicObject, screenRect?: RectangleRange }>}
   * @private
   */
  #previousAomEntries;

  /**
   * 待刷新的旧几何快照
   * @description 用于在对象尚未经历上一帧 render 时，仍能显式保留变更前的屏幕范围。
   * @type {Map<number, RectangleRange>}
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
   * @param {import("../../ui/components/orchestration/viewport.js").Viewport} viewport - 目标视口
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
    return this.#resolveCacheThresholds(this.viewport?.zoom ?? 1) ?? {};
  }

  /**
   * 创建输出层脏区合并器
   * @description 使用 live 层策略（更激进的合并阈值），适用于逐帧变化的 AOM 输出层。
   * @returns {(dirtyRects: any[]) => any[]}
   * @private
   */
  #createOutputDirtyRectMerger() {
    return createRectangleDirtyRectMerger({
      getThresholds: () => this.#resolveOutputThresholds(this.viewport?.zoom ?? 1) ?? {},
      getViewportRect: () => this._getViewportRect(),
    });
  }

  /**
   * 提交一次失效请求到缓存层和输出层调度器
   * @param {any} [rect] - 失效脏区
   * @returns {boolean}
   */
  invalidate(rect) {
    let scheduled = false;
    if (this.#cacheScheduler) {
      scheduled = this.#cacheScheduler.invalidate(rect) || scheduled;
    }
    if (this.#outputScheduler) {
      scheduled = this.#outputScheduler.invalidate(rect) || scheduled;
    }
    return scheduled;
  }

  /**
   * 收集应在输出层绘制的对象（AOM 中的对象）
   * @returns {BasicObject[]}
   * @protected
   */
  _collectDrawables() {
    return this.collectActiveDrawables();
  }

  /**
   * 全量清空输出 canvas
   * @protected
   */
  clear() {
    const output = this._canvas;
    const ctx = output?.getContext?.("2d") ?? null;
    if (!output || !ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, output.width, output.height);
    ctx.restore();
  }

  /**
   * 清空静态缓存 canvas
   * @private
   */
  #clearCache() {
    const cacheCanvas = this.#cache;
    const ctx = cacheCanvas?.getContext?.("2d") ?? null;
    if (!cacheCanvas || !ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);
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
   * @param {*} chunk - 当前区块
   * @param {number} objectId - 对象 id
   * @returns {BasicObject | undefined}
   */
  resolveStaticObject(chunk, objectId) {
    const objectInstance =
      this.viewport?.board?.activeObjectManager?.findBoardObjectInstance?.(
        objectId,
        [chunk?.id],
      ) ?? this.viewport?.board?.getObjectById?.(objectId);

    return objectInstance instanceof BasicObject ? objectInstance : undefined;
  }

  /**
   * 在当前已加载区块内解析静态对象实例
   * @param {Iterable<*>} chunks - 当前已加载区块
   * @param {number} objectId - 对象 id
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
   * @description 优先从 AOM 获取世界范围，以支持 AOM 中活跃对象的变形状态。
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectWorldRect(objectInstance) {
    try {
      const worldRange =
        this.#aom?.getObjectWorldRange?.(objectInstance) ??
        objectInstance?.getRange?.()?.withPosition?.(objectInstance.position);
      if (!worldRange) return undefined;
      return RectangleRange.from(worldRange);
    } catch {
      return undefined;
    }
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
   * @param {Array<{ objectId: number, object: BasicObject, screenRect?: RectangleRange }>} entries - drawable 条目
   * @returns {Map<number, { objectId: number, object: BasicObject, screenRect?: RectangleRange }>}
   */
  indexDrawableEntries(entries) {
    return new Map(entries.map((entry) => [entry.objectId, entry]));
  }

  /**
   * 失效 AOM 对象对应的屏幕脏区（输出层）
   * @description
   * 仅失效输出 canvas，不动缓存。同时失效对象当前范围 + 快照范围 + 上一帧范围，
   * 确保对象位移或几何变化时旧像素也会被清理。
   * @param {Iterable<BasicObject>} [objects = []] - 待失效的 AOM 对象集合
   */
  invalidateActiveObjects(objects = []) {
    const previousEntryIndex = this.indexDrawableEntries(
      this.#previousAomEntries,
    );

    const objectSet = new Set(
      Array.from(objects).map((obj) =>
        obj instanceof BasicObject ? obj.id : obj,
      ),
    );

    const dirtyRects = Array.from(objects).flatMap((objectInstance) => {
      const rects = [];
      const currentRect = this.getObjectScreenRect(objectInstance);
      const snapshotRect = this.#objectSnapshotRects.get(objectInstance.id);
      const previousRect = previousEntryIndex.get(
        objectInstance.id,
      )?.screenRect;

      if (currentRect) rects.push(currentRect);
      if (snapshotRect) rects.push(snapshotRect);
      if (previousRect) rects.push(previousRect);

      return rects;
    });

    // 除传入对象外，将其他 AOM 静止对象的屏幕矩形也加入脏区，
    // 确保输出层渲染时脏区覆盖所有 AOM 对象，
    // 避免静止对象仅被裁剪到运动对象脏区的子集，产生拼接细线。
    if (dirtyRects.length > 0 && objectSet.size > 0) {
      const allAomDrawables = this.collectActiveDrawables();
      for (const aomObject of allAomDrawables) {
        if (objectSet.has(aomObject.id)) continue;
        const rect = this.getObjectScreenRect(aomObject);
        if (rect) dirtyRects.push(rect);
      }
    }

    const targetDirtyRects =
      dirtyRects.length > 0
        ? dirtyRects
        : [
          ...this.createDrawableEntries(this.collectActiveDrawables()),
          ...this.#previousAomEntries,
        ]
          .map((entry) => this.normalizeScreenRect(entry?.screenRect))
          .filter(Boolean);

    for (const dirtyRect of targetDirtyRects) {
      this.#outputScheduler.invalidate(dirtyRect);
    }
  }

  /**
   * 失效静态对象对应的屏幕脏区（缓存层 + 输出层）
   * @description
   * 标记缓存脏，同时失效对象当前范围与旧世界范围（若提供）。
   * 适用于 commit / delete 等静态图变更场景。
   * @param {Iterable<BasicObject>} [objects = []] - 待失效的静态对象集合
   * @param {{ previousWorldRects?: Map<number, RectangleRange> }} [options = {}] - 旧世界范围快照
   * @returns {RectangleRange[]} 实际提交的脏区
   */
  invalidateCachedObjects(objects = [], options = {}) {
    this.#cacheDirty = true;

    const previousWorldRects = options.previousWorldRects ?? new Map();
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

      if (currentRect) dirtyRects.push(currentRect);
      if (previousRect) dirtyRects.push(previousRect);
    }

    const normalizedRects = dirtyRects.filter(
      (dirtyRect) => dirtyRect instanceof RectangleRange,
    );

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
   * 全量拷贝静态缓存到输出 canvas
   * @description 在 clear → copyCache → render 三步流水线中用作第二步。
   * @param {CanvasRenderingContext2D} ctx - 输出 canvas 上下文
   * @private
   */
  #copyCache(ctx) {
    const cacheCanvas = this.#cache;
    if (!ctx || !cacheCanvas) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cacheCanvas, 0, 0);
    ctx.restore();
  }

  /**
   * 将脏区对应的缓存区域拷贝到输出 canvas
   * @param {CanvasRenderingContext2D} ctx - 输出 canvas 上下文
   * @param {RectangleRange[]} rects - 脏区集合
   * @private
   */
  #copyCacheRects(ctx, rects) {
    const cacheCanvas = this.#cache;
    if (!ctx || !cacheCanvas || !Array.isArray(rects)) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const rect of rects) {
      if (!(rect instanceof RectangleRange)) continue;
      ctx.drawImage(
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
    ctx.restore();
  }

  /**
   * 更新静态缓存（全量重绘）
   * @description
   * 临时跳过脏区优化，全量清空缓存 canvas 并重绘所有非 AOM 的静态对象。
   * @param {RectangleRange[]} dirtyRects - 脏区集合（当前忽略，用于全量重绘触发）
   * @private
   */
  #updateCache(dirtyRects) {
    const ctx = this.#cache?.getContext?.("2d") ?? null;
    if (!ctx) return;

    const drawables = this.#collectCacheDrawables();
    const drawableEntries = this.createDrawableEntries(drawables);
    const viewportContext = this.createViewportContext(ctx);

    this.#clearCache();

    for (const entry of drawableEntries) {
      if (typeof entry.object.render !== "function") continue;
      entry.object.render(viewportContext);
    }

    this.#cacheDirty = false;
  }

  /**
   * 在指定 context 上清理脏区
   * @param {CanvasRenderingContext2D} ctx - 目标上下文
   * @param {RectangleRange[]} dirtyRects - 脏区集合
   * @private
   */
  clearDirtyRectsOnContext(ctx, dirtyRects) {
    if (!ctx) return;

    for (const dirtyRect of dirtyRects) {
      const clearRect = expandRectForClear(dirtyRect);
      if (!clearRect) continue;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(
        clearRect.left,
        clearRect.top,
        clearRect.width,
        clearRect.height,
      );
      ctx.restore();
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
    if (this.#cacheScheduler?.dirtyRects?.length > 0) {
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
   * 输出层渲染管线（临时简化版）：脏区清空 + 脏区缓存拷贝 + 全量 AOM 绘制。
   * 保留脏区清空/拷贝逻辑，避免全量 clear 在缓存不完整时把旧像素也抹掉。
   * 1. 按脏区清空输出 canvas
   * 2. 按脏区从缓存拷贝静态内容到输出
   * 3. 全量绘制所有 AOM 对象（无裁剪）
   * 4. 保存状态供下一帧使用
   * @param {Array<RectangleRange>} [dirtyRects] - 可选的屏幕脏区集合
   * @returns {BasicObject[]} 当前渲染的 AOM 对象集合
   * @private
   */
  #renderOutput(dirtyRects) {
    const outputCtx = this._getContext();
    if (!outputCtx) return [];

    const aomDrawables = this.collectActiveDrawables();
    const drawableEntries = this.createDrawableEntries(aomDrawables);
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

    // 按脏区从缓存拷贝静态内容到输出（无脏区时全量拷贝）
    if (normalizedDirtyRects.length > 0) {
      this.#copyCacheRects(outputCtx, normalizedDirtyRects);
    } else {
      this.#copyCache(outputCtx);
    }

    // 全量绘制所有 AOM 对象（无裁剪、无相交判断）
    for (const entry of drawableEntries) {
      if (typeof entry.object.render !== "function") continue;
      entry.object.render(viewportContext);
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
