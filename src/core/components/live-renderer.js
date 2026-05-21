/**
 * @file 活动层渲染器
 * @module core/components/live-renderer
 * @author Zhou Chenyu
 */

import { BasicObject } from "../objects/basic-obj.js";
import { Monitor } from "./monitor.js";
import { ActiveObjectManager, Layer } from "./active-object-manager.js";

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
   * @param {Monitor} monitor - 目标显示器
   * @param {ActiveObjectManager | undefined} activeObjectManager - 活动对象管理器
   */
  constructor(monitor, activeObjectManager) {
    this.monitor = monitor;
    this.activeObjectManager = activeObjectManager;
  }

  /**
   * 更新活动对象管理器引用
   * @param {ActiveObjectManager | undefined} activeObjectManager - 活动对象管理器
   */
  setActiveObjectManager(activeObjectManager) {
    this.activeObjectManager = activeObjectManager;
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

    const drawables = [];
    const inDegreeMap = graph.getInDegreeMap();
    const queue = [];

    for (const [node, inDegree] of inDegreeMap.entries()) {
      if (inDegree === 0) {
        queue.push(node);
      }
    }

    while (queue.length > 0) {
      const objectId = queue.shift();
      const objectInstance = aom.findBoardObjectInstance?.(objectId);
      if (
        objectInstance instanceof BasicObject &&
        !seenObjectIds.has(objectId)
      ) {
        drawables.push(objectInstance);
        seenObjectIds.add(objectId);
      }

      for (const neighbor of graph.neighborsUnsafe(objectId) ?? []) {
        const nextInDegree = (inDegreeMap.get(neighbor) ?? 0) - 1;
        inDegreeMap.set(neighbor, nextInDegree);
        if (nextInDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    return drawables;
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

    const drawables = [];
    for (const objectId of layer?.activeObjects ?? []) {
      const objectInstance = aom.activeObjectIndex?.get?.(objectId);
      if (!(objectInstance instanceof BasicObject)) continue;
      if (seenObjectIds.has(objectId)) continue;
      drawables.push(objectInstance);
      seenObjectIds.add(objectId);
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
      drawables.push(
        ...this.collectInactiveLayerDrawables(layer, seenObjectIds),
      );
      drawables.push(...this.collectActiveLayerDrawables(layer, seenObjectIds));
    }

    for (const objectInstance of aom.activeObjects ?? []) {
      if (!(objectInstance instanceof BasicObject)) continue;
      if (seenObjectIds.has(objectInstance.id)) continue;
      drawables.push(objectInstance);
    }

    return drawables;
  }

  /**
   * 清空 liveCanvas
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

        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },
    });
  }

  /**
   * 渲染当前所有活动对象
   * @returns {BasicObject[]}
   */
  render() {
    const ctx = this.monitor?.getContext?.("live");
    if (!ctx) return [];

    const drawables = this.collectActiveDrawables();
    const viewportContext = this.createViewportContext(ctx);

    this.clear();
    for (const drawable of drawables) {
      if (typeof drawable.render !== "function") continue;
      drawable.render(viewportContext);
    }

    return drawables;
  }

  /**
   * 刷新入口
   * @returns {BasicObject[]}
   */
  flush() {
    return this.render();
  }
}

export { LiveRenderer };
