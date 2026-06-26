/**
 * @file 活动层渲染器
 * @description 提供白板动态图层的渲染与交互更新能力。
 * @module core/components/renderer/live-renderer
 * @author Zhou Chenyu
 */

import { Renderer } from "./renderer.js";
import { BasicObject } from "../../objects/basic-obj.js";
import { RectangleRange } from "../../range/rectangle.js";
import {
  ActiveObjectManager,
  Layer,
} from "../orchestration/active-object-manager.js";

/**
 * 活动层渲染器
 * @description 按 AOM 当前层顺序将动态图对象渲染到 Monitor 的 liveCanvas。
 * @class
 * @extends Renderer
 * @author Zhou Chenyu
 */
class LiveRenderer extends Renderer {
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
   * @param {import("../orchestration/monitor.js").Monitor} monitor - 目标显示器
   * @param {ActiveObjectManager | undefined} activeObjectManager - 活动对象管理器
   */
  constructor(monitor, activeObjectManager) {
    super(monitor);
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
   * 获取 live 层 2D 上下文
   * @returns {CanvasRenderingContext2D | null | undefined}
   * @protected
   */
  _getContext() {
    return this.monitor?.getContext?.("live");
  }

  /**
   * 渲染前同步 base 缓存
   * @description 确保读到最新静态层，防止 base/live 两调度器时序竞争。
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @protected
   */
  _beforeRender(ctx) {
    const baseScheduler = this.monitor?.baseRenderScheduler;
    if (baseScheduler?.framePending) {
      baseScheduler.flush();
    }
  }

  /**
   * 收集应在活动层绘制的对象
   * @returns {BasicObject[]}
   * @protected
   */
  _collectDrawables() {
    return this.collectActiveDrawables();
  }

  /**
   * 全量清空 liveCanvas
   */
  clear() {
    const canvas = this.monitor?.liveCanvas;
    const ctx = this._getContext();
    if (!canvas || !ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /**
   * 清理后拷贝 baseCanvas 到 liveCanvas
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {boolean} hasExplicitDirtyRects - 是否有显式脏区
   * @param {RectangleRange[]} effectiveDirtyRects - 有效脏区
   * @protected
   */
  _afterClear(ctx, hasExplicitDirtyRects, effectiveDirtyRects) {
    if (hasExplicitDirtyRects) {
      this.copyBaseRects(effectiveDirtyRects);
    } else {
      this.copyBase();
    }
  }

  /**
   * 渲染后保存上一帧缓存
   * @param {BasicObject[]} drawables - 已绘制的对象
   * @param {Array<{ objectId: number, object: BasicObject, screenRect?: RectangleRange }>} drawableEntries - drawable 条目
   * @protected
   */
  _afterRender(drawables, drawableEntries) {
    this.previousDrawableEntries = drawableEntries;
    this.objectSnapshotRects.clear();
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
        this.activeObjectManager?.getObjectWorldRange?.(objectInstance) ??
        objectInstance?.getRange?.()?.withPosition?.(objectInstance.position);
      if (!worldRange) return undefined;
      return RectangleRange.from(worldRange);
    } catch {
      return undefined;
    }
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
   * 收集某层按 inactive 语义参与绘制的对象 id
   * @param {Layer} layer - 当前层
   * @returns {number[]}
   */
  collectSemanticInactiveLayerObjectIds(layer) {
    const objectIds = Array.from(
      layer?.inactiveGraph?.getTopologicalOrder?.() ?? [],
    );

    if (layer?.active === false) {
      for (const objectId of layer.activeObjects ?? []) {
        if (objectIds.includes(objectId)) continue;
        objectIds.push(objectId);
      }
    }

    return objectIds;
  }

  /**
   * 按 inactive 语义收集某层的对象
   * @param {Layer} layer - 当前层
   * @param {Set<number>} seenObjectIds - 已收集对象 id
   * @returns {BasicObject[]}
   */
  collectInactiveLayerDrawables(layer, seenObjectIds) {
    const aom = this.activeObjectManager;
    if (!aom) return [];

    return this.collectDrawablesByObjectIds(
      this.collectSemanticInactiveLayerObjectIds(layer),
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
    if (!aom || layer?.active === false) return [];

    return this.collectDrawablesByObjectIds(
      layer?.activeObjects,
      (objectId) => aom.activeObjectIndex?.get?.(objectId),
      seenObjectIds,
    );
  }

  /**
   * 收集某层的可绘制对象
   * @description
   * active layer 中先绘制 activeObjects，再绘制 inactive 语义对象；
   * inactive layer 中，activeObjects 也会按 inactive 语义参与绘制。
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
   * 收集应绘制的动态图对象
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
   * 全量拷贝 baseCanvas（静态缓存）到 liveCanvas
   * @description
   * 在 clear → copyBase → render 三步流水线中用作第二步。
   * 将 baseCanvas 当前像素完整拷贝到 liveCanvas，
   * 与 clear 配合替代浏览器 GPU 图层合成。
   * baseCanvas 不存在时静默返回。
   */
  copyBase() {
    const ctx = this._getContext();
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
    const ctx = this._getContext();
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
        : [
            ...this.createDrawableEntries(this.collectActiveDrawables()),
            ...this.previousDrawableEntries,
          ]
            .map((entry) => this.normalizeScreenRect(entry?.screenRect))
            .filter(Boolean);

    for (const dirtyRect of targetDirtyRects) {
      this.monitor?.renderScheduler?.invalidate?.(dirtyRect);
    }
  }
}

export { LiveRenderer };
