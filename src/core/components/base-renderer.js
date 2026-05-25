/**
 * @file 静态层渲染器
 * @description 提供白板静态层的脏区域渲染与清理逻辑。
 * @module core/components/base-renderer
 * @author Zhou Chenyu
 */

import { BasicObject } from "../objects/basic-obj.js";
import { intersectsRanges, PathRange, RectangleRange } from "../range/index.js";
import { DirectedGraph } from "../utils/directed-graph.js";
import { Monitor } from "./monitor.js";
import { mergeRectangleDirtyRects } from "./render-scheduler.js";

const PATH_RASTERIZATION_SCREEN_PADDING = 1;

function expandRectForClear(rect) {
  const normalizedRect = RectangleRange.fromRectLike(rect);
  if (!normalizedRect) return undefined;

  const left = Math.floor(normalizedRect.left);
  const top = Math.floor(normalizedRect.top);
  const right = Math.ceil(normalizedRect.right);
  const bottom = Math.ceil(normalizedRect.bottom);

  return new RectangleRange(left, top, right - left, bottom - top);
}

function normalizeDirtyRectsForScreenUpdate(dirtyRects = []) {
  return dirtyRects
    .map((dirtyRect) => expandRectForClear(dirtyRect))
    .filter(Boolean);
}

/**
 * 静态层渲染器
 * @description 按当前 Monitor 已加载区块中的静态图顺序，将静态对象渲染到 baseCanvas。
 * 当前已支持显式 dirty rect 驱动的局部清理与局部重绘。
 * @class
 * @author Zhou Chenyu
 */
class BaseRenderer {
  /**
   * 绑定的显示器
   * @type {Monitor}
   */
  monitor;

  /**
   * @param {Monitor} monitor - 目标显示器
   */
  constructor(monitor) {
    this.monitor = monitor;
  }

  /**
   * 获取区块的世界矩形范围
   * @param {*} chunk - 区块实例
   * @returns {RectangleRange | undefined}
   */
  getChunkWorldRect(chunk) {
    if (!chunk) return undefined;

    const chunkWidth = this.monitor?.chunkWidth ?? 0;
    const chunkHeight = this.monitor?.chunkHeight ?? 0;
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
    return this.monitor?.worldRectToScreenRect?.(worldRect);
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

    const origin = viewportState.origin ?? this.monitor?.origin;
    const zoom = viewportState.zoom ?? this.monitor?.zoom ?? 1;

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
      this.monitor?.board?.activeObjectManager?.findBoardObjectInstance?.(
        objectId,
        [chunk?.id],
      ) ?? this.monitor?.board?.getObjectById?.(objectId);

    return objectInstance instanceof BasicObject ? objectInstance : undefined;
  }

  /**
   * 获取对象的世界矩形范围
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectWorldRect(objectInstance) {
    try {
      const worldRange = objectInstance
        ?.getRange?.()
        ?.withPosition?.(objectInstance.position);
      if (!worldRange) return undefined;
      return RectangleRange.from(worldRange);
    } catch {
      return undefined;
    }
  }

  /**
   * 获取对象的屏幕留白
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {number} 屏幕空间留白
   */
  getObjectScreenPadding(objectInstance) {
    const objectPadding = objectInstance?.getRenderPadding?.();
    const basePadding =
      Number.isFinite(objectPadding) && objectPadding > 0
        ? objectPadding * (this.monitor?.zoom ?? 1)
        : 0;
    const objectRange = objectInstance?.getRange?.();

    if (objectRange instanceof PathRange) {
      return basePadding + PATH_RASTERIZATION_SCREEN_PADDING;
    }

    return basePadding;
  }

  /**
   * 将世界矩形换算为带留白的屏幕矩形
   * @param {RectangleRange | import("../range/range.js").Range | { left: number, top: number, width?: number, height?: number, right?: number, bottom?: number }} worldRect - 世界矩形
   * @param {number} [padding = 0] - 屏幕空间留白
   * @returns {RectangleRange | undefined}
   */
  getScreenRectForWorldRect(worldRect, padding = 0) {
    const normalizedWorldRect = RectangleRange.fromRectLike(worldRect);
    if (!normalizedWorldRect) return undefined;

    const screenRect =
      this.monitor?.worldRectToScreenRect?.(normalizedWorldRect);
    if (!screenRect) return undefined;

    return screenRect.inflate(padding);
  }

  /**
   * 获取对象的屏幕矩形范围
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectScreenRect(objectInstance) {
    const worldRect = this.getObjectWorldRect(objectInstance);
    if (!worldRect) return undefined;

    return this.getScreenRectForWorldRect(
      worldRect,
      this.getObjectScreenPadding(objectInstance),
    );
  }

  /**
   * 规范化屏幕矩形
   * @param {RectangleRange | { left: number, top: number, width?: number, height?: number, right?: number, bottom?: number }} rect - 原始矩形
   * @returns {RectangleRange | undefined}
   */
  normalizeScreenRect(rect) {
    return RectangleRange.fromRectLike(rect);
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
      this.monitor?.board?.activeObjectManager?.findBoardObjectInstance?.(
        objectId,
        candidateChunkIds,
      ) ?? this.monitor?.board?.getObjectById?.(objectId);

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
   * 收集当前 monitor 已加载区块中的静态对象
   * @returns {BasicObject[]}
   */
  collectStaticDrawables() {
    const chunks = this.monitor?.chunkBlockLoader?.getLoadedChunks?.() ?? [];
    return this.mergeStaticGraphs(chunks);
  }

  /**
   * 创建 drawable 条目
   * @param {BasicObject[]} drawables - 对象实例集合
   * @returns {Array<{ objectId: number, object: BasicObject, screenRect?: RectangleRange }>}
   */
  createDrawableEntries(drawables) {
    return drawables.map((objectInstance) => ({
      objectId: objectInstance.id,
      object: objectInstance,
      screenRect: this.getObjectScreenRect(objectInstance),
    }));
  }

  /**
   * 收集待处理脏区
   * @param {Array<RectangleRange | { left: number, top: number, width?: number, height?: number, right?: number, bottom?: number }>} [dirtyRects = []] - 外部传入脏区
   * @returns {RectangleRange[]}
   */
  collectDirtyRects(dirtyRects = []) {
    return dirtyRects
      .map((rect) => this.normalizeScreenRect(rect))
      .filter(Boolean);
  }

  /**
   * 判断对象条目是否与任一脏区相交
   * @param {{ screenRect?: RectangleRange }} entry - drawable 条目
   * @param {RectangleRange[]} dirtyRects - 脏区集合
   * @returns {boolean}
   */
  intersectsDirtyRects(entry, dirtyRects) {
    const rect = entry?.screenRect;
    if (!rect) return dirtyRects.length === 0;

    return dirtyRects.some((dirtyRect) => intersectsRanges(rect, dirtyRect));
  }

  /**
   * 收集与条目相交的脏区
   * @param {{ screenRect?: RectangleRange }} entry - drawable 条目
   * @param {RectangleRange[]} dirtyRects - 脏区集合
   * @returns {RectangleRange[]} 相交脏区
   */
  getEntryDirtyRects(entry, dirtyRects) {
    const rect = entry?.screenRect;
    if (!rect) return dirtyRects;

    return dirtyRects.filter((dirtyRect) => intersectsRanges(rect, dirtyRect));
  }

  /**
   * 清理脏区
   * @param {RectangleRange[]} dirtyRects - 脏区集合
   */
  clearDirtyRects(dirtyRects) {
    const ctx = this.monitor?.getContext?.("base");
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
   * 在指定脏区裁剪下渲染对象
   * @param {CanvasRenderingContext2D} ctx - 原始 2D 上下文
   * @param {CanvasRenderingContext2D} viewportContext - 视口上下文
   * @param {BasicObject} objectInstance - 待绘制对象
   * @param {RectangleRange[]} dirtyRects - 裁剪脏区
   */
  renderObjectWithinDirtyRects(
    ctx,
    viewportContext,
    objectInstance,
    dirtyRects,
  ) {
    if (!Array.isArray(dirtyRects) || dirtyRects.length === 0) {
      objectInstance.render(viewportContext);
      return;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (const dirtyRect of dirtyRects) {
      ctx.rect(
        dirtyRect.left,
        dirtyRect.top,
        dirtyRect.width,
        dirtyRect.height,
      );
    }
    ctx.clip();
    objectInstance.render(viewportContext);
    ctx.restore();
  }

  /**
   * 失效指定对象的静态层屏幕脏区
   * @param {Iterable<BasicObject>} [objects = []] - 待刷新的对象集合
   * @param {{ previousWorldRects?: Map<number, RectangleRange> }} [options = {}] - 旧世界范围快照
   * @returns {RectangleRange[]} 实际提交的脏区
   */
  invalidateObjects(objects = [], options = {}) {
    const previousWorldRects = options.previousWorldRects ?? new Map();
    const dirtyRects = [];

    for (const objectInstance of objects ?? []) {
      if (!(objectInstance instanceof BasicObject)) continue;

      const padding = this.getObjectScreenPadding(objectInstance);
      const currentRect = this.getObjectScreenRect(objectInstance);
      const previousWorldRect = previousWorldRects.get(objectInstance.id);
      const previousRect = previousWorldRect
        ? this.getScreenRectForWorldRect(previousWorldRect, padding)
        : undefined;

      if (currentRect) dirtyRects.push(currentRect);
      if (previousRect) dirtyRects.push(previousRect);
    }

    const mergeDirtyRects =
      this.monitor?.baseRenderScheduler?.mergeDirtyRects ??
      mergeRectangleDirtyRects;
    const mergedDirtyRects = mergeDirtyRects(dirtyRects).filter(
      (dirtyRect) => dirtyRect instanceof RectangleRange,
    );

    for (const dirtyRect of mergedDirtyRects) {
      this.monitor?.baseRenderScheduler?.invalidate?.(dirtyRect);
    }

    return mergedDirtyRects;
  }

  /**
   * 失效指定区块对应的屏幕脏区
   * @param {Iterable<*>} [chunks = []] - 当前区块集合
   * @param {Iterable<*>} [previousChunks = []] - 变更前区块集合
   */
  invalidateChunks(chunks = [], previousChunks = [], options = {}) {
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
      this.monitor?.baseRenderScheduler?.invalidate?.(dirtyRect);
    }
  }

  /**
   * 清空 baseCanvas
   */
  clear() {
    const canvas = this.monitor?.baseCanvas;
    const ctx = this.monitor?.getContext?.("base");
    if (!canvas || !ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /**
   * 将世界坐标变换折算到屏幕坐标
   * @param {CanvasRenderingContext2D} ctx - 原始 2D 上下文
   * @returns {CanvasRenderingContext2D}
   */
  createViewportContext(ctx) {
    const monitor = this.monitor;
    const zoom = monitor?.zoom ?? 1;
    const originX = monitor?.origin?.x ?? 0;
    const originY = monitor?.origin?.y ?? 0;

    return new Proxy(ctx, {
      get(target, prop, receiver) {
        if (prop === "setTransform") {
          return (a, b, c, d, e, f) => {
            const translatedE = (e - originX) * zoom;
            const translatedF = (f - originY) * zoom;
            return target.setTransform(
              a * zoom,
              b * zoom,
              c * zoom,
              d * zoom,
              translatedE,
              translatedF,
            );
          };
        }

        const value = Reflect.get(target, prop, target);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },

      set(target, prop, value) {
        return Reflect.set(target, prop, value, target);
      },
    });
  }

  /**
   * 渲染当前静态层对象
   * @returns {BasicObject[]} 当前渲染的对象集合
   */
  render(dirtyRects) {
    const ctx = this.monitor?.getContext?.("base");
    if (!ctx) return [];

    const drawables = this.collectStaticDrawables();
    const drawableEntries = this.createDrawableEntries(drawables);
    const viewportContext = this.createViewportContext(ctx);
    const hasExplicitDirtyRects =
      Array.isArray(dirtyRects) && dirtyRects.length > 0;
    const effectiveDirtyRects = hasExplicitDirtyRects
      ? normalizeDirtyRectsForScreenUpdate(this.collectDirtyRects(dirtyRects))
      : [];

    if (hasExplicitDirtyRects) {
      this.clearDirtyRects(effectiveDirtyRects);
    } else {
      this.clear();
    }

    for (const entry of drawableEntries) {
      if (hasExplicitDirtyRects) {
        if (!this.intersectsDirtyRects(entry, effectiveDirtyRects)) continue;
      }
      if (typeof entry.object.render !== "function") continue;

      const entryDirtyRects = hasExplicitDirtyRects
        ? this.getEntryDirtyRects(entry, effectiveDirtyRects)
        : [];

      this.renderObjectWithinDirtyRects(
        ctx,
        viewportContext,
        entry.object,
        entryDirtyRects,
      );
    }

    return drawables;
  }

  /**
   * 刷新入口
   * @returns {BasicObject[]} 当前渲染的对象集合
   */
  flush(dirtyRects) {
    return this.render(dirtyRects);
  }
}

export { BaseRenderer };
