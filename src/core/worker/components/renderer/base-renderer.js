/**
 * @file 静态层渲染器
 * @description 提供白板静态层的脏区域渲染与清理逻辑。
 * @module core/worker/components/renderer/base-renderer
 * @author Zhou Chenyu
 */

import { Renderer } from "../../../shared/renderer/renderer.js";
import { BasicObject } from "../../../shared/objects/basic-obj.js";
import { RectangleRange } from "../../../shared/range/rectangle.js";
import { DirectedGraph } from "../../../utils/directed-graph.js";
import {
  createBaseDirtyRectCanonicalRectsResolver,
  createBaseDirtyRectThresholdStrategy,
} from "./dirty-rect-strategy.js";

/**
 * 静态层渲染器
 * @description 按当前 Viewport 已加载区块中的静态图顺序，将静态对象渲染到 baseCanvas。
 * 自管理 baseCanvas、渲染调度器与脏区合并策略。
 * @class
 * @extends Renderer
 * @author Zhou Chenyu
 */
class BaseRenderer extends Renderer {
  /**
   * base 层缩放感知的脏区合并阈值策略
   * @type {(zoom: number) => Record<string, number | undefined>}
   * @private
   */
  _resolveThresholds;

  /**
   * @param {import("../../ui/components/orchestration/viewport.js").Viewport} viewport - 目标视口
   * @param {{ canvas?: HTMLCanvasElement | null }} [options = {}] - 初始化选项
   */
  constructor(viewport, options = {}) {
    super(viewport, options);
    this._resolveThresholds = createBaseDirtyRectThresholdStrategy();
    this._initScheduler();
  }

  /**
   * 全量清空 baseCanvas
   */
  clear() {
    const canvas = this._canvas;
    const ctx = canvas?.getContext?.("2d") ?? null;
    if (!canvas || !ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /**
   * 获取当前脏区合并阈值
   * @returns {Record<string, number | undefined>}
   * @protected
   */
  _getThresholds() {
    return this._resolveThresholds(this.viewport?.zoom ?? 1) ?? {};
  }

  /**
   * 获取脏区对应的已加载区块的屏幕矩形集合
   * @param {any} dirtyRect - 脏区
   * @returns {any[]}
   * @protected
   */
  _getCanonicalRectsForRect(dirtyRect) {
    return createBaseDirtyRectCanonicalRectsResolver({
      getOrigin: () => this.viewport?.origin,
      getZoom: () => this.viewport?.zoom,
      getLoadedChunks: () =>
        this.viewport?.chunkLoader?.getLoadedChunks?.() ?? [],
      getChunkById: (chunkId) => this.viewport?.board?.getChunkById?.(chunkId),
      getChunkWidth: () => this.viewport?.chunkWidth,
      getChunkHeight: () => this.viewport?.chunkHeight,
      getChunkScreenRect: (chunk) => this.getChunkScreenRect(chunk),
    })(dirtyRect);
  }

  /**
   * 收集应在静态层绘制的对象
   * @description 合并已加载区块的静态图，过滤掉当前 AOM 管理的对象。
   * @returns {BasicObject[]}
   * @protected
   */
  _collectDrawables() {
    const allDrawables = this.collectStaticDrawables();
    const aom = this.viewport?.board?.activeObjectManager;
    return typeof aom?.has === "function"
      ? allDrawables.filter((obj) => !aom.has(obj.id))
      : allDrawables;
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
   * 失效指定区块对应的屏幕脏区
   * @param {Iterable<*>} [chunks = []] - 当前区块集合
   * @param {Iterable<*>} [previousChunks = []] - 变更前区块集合
   * @param {{ previousViewportState?: { origin?: { x: number, y: number }, zoom?: number } }} [options = {}] - 旧视口状态
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
      this.invalidate(dirtyRect);
    }
  }
}

export { BaseRenderer };
