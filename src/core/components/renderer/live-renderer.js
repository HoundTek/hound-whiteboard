/**
 * @file 活动层渲染器
 * @description 提供白板活动层的渲染与交互更新能力。
 * @module core/components/live-renderer
 * @author Zhou Chenyu
 */

import { BasicObject } from "../../objects/basic-obj.js";
import { PathRange } from "../../range/path.js";
import { RectangleRange } from "../../range/rectangle.js";
import { Monitor } from "../orchestration/monitor.js";
import {
  ActiveObjectManager,
  Layer,
} from "../orchestration/active-object-manager.js";

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
 * 活动层渲染器
 * @description 按 AOM 当前层顺序将活动对象渲染到 Monitor 的 liveCanvas。
 * @class
 * @author Zhou Chenyu
 */
class LiveRenderer {
  /**
   * 绑定的显示器
   * @type {Monitor}
   */
  monitor;

  /**
   * 活动对象管理器
   * @type {ActiveObjectManager | undefined}
   */
  activeObjectManager;

  /**
   * 上一帧的 drawable 条目缓存
   * @description 用于在对象移动或变形后同时拿到旧屏幕范围与新屏幕范围，避免 liveCanvas 残影。
   * @type {Array<{ objectId: number, object: BasicObject, screenRect?: RectangleRange }>}
   */
  previousDrawableEntries;

  /**
   * 待刷新的旧几何快照
   * @description 用于在对象尚未经历上一帧 render 时，仍能显式保留变更前的屏幕范围。
   * @type {Map<number, RectangleRange>}
   */
  objectSnapshotRects;

  /**
   * @param {Monitor} monitor - 目标显示器
   * @param {ActiveObjectManager | undefined} activeObjectManager - 活动对象管理器
   */
  constructor(monitor, activeObjectManager) {
    this.monitor = monitor;
    this.activeObjectManager = activeObjectManager;
    this.previousDrawableEntries = [];
    this.objectSnapshotRects = new Map();
  }

  /**
   * 更新活动对象管理器引用
   * @param {ActiveObjectManager | undefined} activeObjectManager - 活动对象管理器
   */
  setActiveObjectManager(activeObjectManager) {
    this.activeObjectManager = activeObjectManager;
  }

  /**
   * 按对象 id 序列解析并收集可绘制对象
   * @param {Iterable<number>} objectIds - 对象 id 序列
   * @param {(objectId: number) => BasicObject | undefined} resolveObject - 对象解析器
   * @param {Set<number>} seenObjectIds - 已收集对象 id
   * @returns {BasicObject[]}
   */
  collectDrawablesByObjectIds(objectIds, resolveObject, seenObjectIds) {
    const drawables = [];

    for (const objectId of objectIds ?? []) {
      if (seenObjectIds.has(objectId)) continue;

      const objectInstance = resolveObject?.(objectId);
      if (!(objectInstance instanceof BasicObject)) continue;

      drawables.push(objectInstance);
      seenObjectIds.add(objectId);
    }

    return drawables;
  }

  /**
   * 按拓扑序收集某层的非活动对象
   * @param {Layer} layer - 当前层
   * @param {Set<number>} seenObjectIds - 已收集对象 id
   * @returns {BasicObject[]}
   */
  collectInactiveLayerDrawables(layer, seenObjectIds) {
    const graph = layer?.inactiveGraph;
    const aom = this.activeObjectManager;
    if (!graph || !aom) return [];

    return this.collectDrawablesByObjectIds(
      graph.getTopologicalOrder(),
      (objectId) => aom.findBoardObjectInstance?.(objectId),
      seenObjectIds,
    );
  }

  /**
   * 收集某层的活动对象
   * @param {Layer} layer - 当前层
   * @param {Set<number>} seenObjectIds - 已收集对象 id
   * @returns {BasicObject[]}
   */
  collectActiveLayerDrawables(layer, seenObjectIds) {
    const aom = this.activeObjectManager;
    if (!aom) return [];

    return this.collectDrawablesByObjectIds(
      layer?.activeObjects,
      (objectId) => aom.activeObjectIndex?.get?.(objectId),
      seenObjectIds,
    );
  }

  /**
   * 收集某层的可绘制对象
   * @param {Layer} layer - 当前层
   * @param {Set<number>} seenObjectIds - 已收集对象 id
   * @returns {BasicObject[]}
   */
  collectLayerDrawables(layer, seenObjectIds) {
    return [
      ...this.collectActiveLayerDrawables(layer, seenObjectIds),
      ...this.collectInactiveLayerDrawables(layer, seenObjectIds),
    ];
  }

  /**
   * 收集未落入 layerOrder 的活动对象
   * @param {Set<number>} seenObjectIds - 已收集对象 id
   * @returns {BasicObject[]}
   */
  collectFallbackActiveDrawables(seenObjectIds) {
    const aom = this.activeObjectManager;
    if (!aom) return [];

    const drawables = [];
    for (const objectInstance of aom.activeObjects ?? []) {
      if (!(objectInstance instanceof BasicObject)) continue;
      if (seenObjectIds.has(objectInstance.id)) continue;
      drawables.push(objectInstance);
      seenObjectIds.add(objectInstance.id);
    }

    return drawables;
  }

  /**
   * 收集应绘制的活动对象
   * @returns {BasicObject[]}
   */
  collectActiveDrawables() {
    const aom = this.activeObjectManager;
    if (!aom) return [];

    const drawables = [];
    const seenObjectIds = new Set();

    for (const layer of aom.layerOrder ?? []) {
      drawables.push(...this.collectLayerDrawables(layer, seenObjectIds));
    }

    drawables.push(...this.collectFallbackActiveDrawables(seenObjectIds));

    return drawables;
  }

  /**
   * 获取对象的世界矩形范围
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectWorldRect(objectInstance) {
    try {
      const worldRange =
        this.activeObjectManager?.getObjectWorldRange?.(objectInstance) ??
        objectInstance?.getRange?.()?.withPosition?.(objectInstance.position);
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
   * 获取对象的屏幕矩形范围
   * @param {BasicObject} objectInstance - 对象实例
   * @returns {RectangleRange | undefined}
   */
  getObjectScreenRect(objectInstance) {
    const worldRect = this.getObjectWorldRect(objectInstance);
    if (!worldRect) return undefined;

    const screenRect = this.monitor?.worldRectToScreenRect?.(worldRect);
    if (!screenRect) return undefined;

    return screenRect.inflate(this.getObjectScreenPadding(objectInstance));
  }

  /**
   * 规范化屏幕矩形
   * @param {RectangleRange | { left: number, top: number, width?: number, height?: number, right?: number, bottom?: number }} rect - 原始矩形
   * @returns {RectangleRange | undefined}
   */
  normalizeScreenRect(rect) {
    if (!rect) return undefined;
    if (rect instanceof RectangleRange) {
      return RectangleRange.from(rect);
    }

    const left = rect.left ?? 0;
    const top = rect.top ?? 0;
    const right = rect.right ?? left + (rect.width ?? 0);
    const bottom = rect.bottom ?? top + (rect.height ?? 0);
    const width = rect.width ?? right - left;
    const height = rect.height ?? bottom - top;

    return new RectangleRange(left, top, width, height);
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

    return dirtyRects.filter((dirtyRect) => {
      return !(
        rect.right <= dirtyRect.left ||
        rect.left >= dirtyRect.right ||
        rect.bottom <= dirtyRect.top ||
        rect.top >= dirtyRect.bottom
      );
    });
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
   * 按对象 id 索引 drawable 条目
   * @param {Array<{ objectId: number, object: BasicObject, screenRect?: RectangleRange }>} entries - drawable 条目
   * @returns {Map<number, { objectId: number, object: BasicObject, screenRect?: RectangleRange }>}
   */
  indexDrawableEntries(entries) {
    return new Map(entries.map((entry) => [entry.objectId, entry]));
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

      const previousSnapshot = this.objectSnapshotRects.get(objectInstance.id);
      this.objectSnapshotRects.set(
        objectInstance.id,
        previousSnapshot ? previousSnapshot.union(currentRect) : currentRect,
      );
    }
  }

  /**
   * 收集待处理脏区
   * @param {Array<{ screenRect?: RectangleRange }>} currentEntries - 当前 drawable 条目
   * @param {Array<{ screenRect?: RectangleRange }>} [previousEntries = []] - 上一帧 drawable 条目
   * @param {Array<RectangleRange | { left: number, top: number, width?: number, height?: number, right?: number, bottom?: number }>} [dirtyRects] - 外部传入脏区
   * @returns {RectangleRange[]}
   */
  collectDirtyRects(currentEntries, previousEntries = [], dirtyRects) {
    if (Array.isArray(dirtyRects) && dirtyRects.length > 0) {
      return dirtyRects
        .map((rect) => this.normalizeScreenRect(rect))
        .filter(Boolean);
    }

    return [...previousEntries, ...currentEntries]
      .map((entry) => this.normalizeScreenRect(entry?.screenRect))
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

    return dirtyRects.some((dirtyRect) => {
      return !(
        rect.right <= dirtyRect.left ||
        rect.left >= dirtyRect.right ||
        rect.bottom <= dirtyRect.top ||
        rect.top >= dirtyRect.bottom
      );
    });
  }

  /**
   * 清理脏区
   * @param {RectangleRange[]} dirtyRects - 脏区集合
   */
  clearDirtyRects(dirtyRects) {
    const ctx = this.monitor?.getContext?.("live");
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
   * 失效指定对象对应的屏幕脏区
   * @description 同时失效对象当前范围与上一帧范围，确保对象位移或几何变化时旧像素也会被清理。
   * @param {Iterable<BasicObject>} [objects = []] - 待刷新的对象集合
   */
  invalidateObjects(objects = []) {
    const previousEntryIndex = this.indexDrawableEntries(
      this.previousDrawableEntries,
    );
    const dirtyRects = Array.from(objects).flatMap((objectInstance) => {
      const rects = [];
      const currentRect = this.getObjectScreenRect(objectInstance);
      const snapshotRect = this.objectSnapshotRects.get(objectInstance.id);
      const previousRect = previousEntryIndex.get(
        objectInstance.id,
      )?.screenRect;

      if (currentRect) rects.push(currentRect);
      if (snapshotRect) rects.push(snapshotRect);
      if (previousRect) rects.push(previousRect);

      return rects;
    });

    const targetDirtyRects =
      dirtyRects.length > 0
        ? dirtyRects
        : this.collectDirtyRects(
            this.createDrawableEntries(this.collectActiveDrawables()),
            this.previousDrawableEntries,
          );

    for (const dirtyRect of targetDirtyRects) {
      this.monitor?.renderScheduler?.invalidate?.(dirtyRect);
    }
  }

  /**
   * 清空 liveCanvas
   * @description 在 clear → copyBase → render 三步流水线中用作第一步，抹掉所有旧像素。
   */
  clear() {
    const canvas = this.monitor?.liveCanvas;
    const ctx = this.monitor?.getContext?.("live");
    if (!canvas || !ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /**
   * 全量拷贝 baseCanvas（静态缓存）到 liveCanvas
   * @description
   * 在 clear → copyBase → render 三步流水线中用作第二步。
   * 将 baseCanvas 当前像素完整拷贝到 liveCanvas，
   * 与 clear 配合替代浏览器 GPU 图层合成。
   * baseCanvas 视为 liveCanvas 的预渲染缓存（CSS opacity: 0 隐藏）。
   * baseCanvas 不存在时静默返回。
   */
  copyBase() {
    const ctx = this.monitor?.getContext?.("live");
    const baseCanvas = this.monitor?.baseCanvas;
    if (!ctx || !baseCanvas) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.restore();
  }

  /**
   * 将脏区对应的 baseCanvas 区域拷贝到 liveCanvas
   * @description
   * copyBase 的脏区版本，只拷贝 dirtyRects 指定的区域而非全量。
   * 在 clear → copyBaseRects → render 三步流水线中用作第二步。
   * 用于局部刷新场景，避免全量 drawImage 开销。
   * @param {RectangleRange[]} rects - 脏区集合，只拷贝这些区域
   */
  copyBaseRects(rects) {
    const ctx = this.monitor?.getContext?.("live");
    const baseCanvas = this.monitor?.baseCanvas;
    if (!ctx || !baseCanvas || !Array.isArray(rects)) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const rect of rects) {
      if (!(rect instanceof RectangleRange)) continue;
      ctx.drawImage(
        baseCanvas,
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
   * 渲染当前所有活动对象
   * @description
   * 按 clear → copyBase → render 三步流水线工作：
   * 1. 清理脏区（抹掉旧像素和残留活动对象）
   * 2. 从 baseCanvas（静态缓存）拷贝像素到 liveCanvas（替代 GPU 合成）
   * 3. 将 AOM 活动对象绘制到 liveCanvas 上
   *
   * 显式传入 dirtyRects 时只处理脏区区域；无参调用做全量刷新。
   *
   * 在拷贝 baseCanvas 前会检查 baseRenderScheduler 是否有待处理帧，
   * 有则同步 flush 以保证读到最新的缓存状态，防止时序竞争。
   * @param {Array<RectangleRange>} [dirtyRects] - 可选的屏幕脏区集合
   * @returns {BasicObject[]} 当前渲染的对象集合
   */
  render(dirtyRects) {
    const ctx = this.monitor?.getContext?.("live");
    if (!ctx) return [];

    // 同步 base 缓存：确保读到最新静态层，防止 base/live 两调度器时序竞争
    const baseScheduler = this.monitor?.baseRenderScheduler;
    if (baseScheduler?.framePending) {
      baseScheduler.flush();
    }

    const drawables = this.collectActiveDrawables();
    const drawableEntries = this.createDrawableEntries(drawables);
    const viewportContext = this.createViewportContext(ctx);
    const hasExplicitDirtyRects =
      Array.isArray(dirtyRects) && dirtyRects.length > 0;
    const effectiveDirtyRects = hasExplicitDirtyRects
      ? normalizeDirtyRectsForScreenUpdate(
          this.collectDirtyRects(
            drawableEntries,
            this.previousDrawableEntries,
            dirtyRects,
          ),
        )
      : [];

    // 先清理脏区，抹掉旧像素（包括上一帧残留的活动对象）
    if (hasExplicitDirtyRects) {
      this.clearDirtyRects(effectiveDirtyRects);
    } else {
      this.clear();
    }

    // 再从 baseCanvas（缓存）拷贝静态层到 liveCanvas
    if (hasExplicitDirtyRects) {
      this.copyBaseRects(effectiveDirtyRects);
    } else {
      this.copyBase();
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

    this.previousDrawableEntries = drawableEntries;
    this.objectSnapshotRects.clear();

    return drawables;
  }

  /**
   * 刷新入口
   * @param {Array<RectangleRange>} [dirtyRects] - 可选的屏幕脏区集合
   * @returns {BasicObject[]} 当前渲染的对象集合
   */
  flush(dirtyRects) {
    return this.render(dirtyRects);
  }
}

export { LiveRenderer };
