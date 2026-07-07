/**
 * @file 白板 UI 渲染钩子工厂
 * @description
 * 创建与 UI 侧 viewport/renderer 连通的 AOM render hooks 实现。
 * AOM 通过这组钩子间接发起到各 viewport 的渲染请求，不再直接访问 board.viewports。
 * @module core/ui/components/orchestration/board-render-hooks
 * @author Zhou Chenyu
 */

import { RectangleRange, intersectsRanges } from "../../../shared/range/index.js";

/**
 * 解析 viewports 引用
 * @param {Map<string, import("./viewport.js").Viewport> | (() => Map<string, import("./viewport.js").Viewport>)} viewportsOrFn - viewports Map 或返回 Map 的函数
 * @returns {Map<string, import("./viewport.js").Viewport> | undefined}
 */
function _resolveViewports(viewportsOrFn) {
  if (typeof viewportsOrFn === "function") {
    return viewportsOrFn();
  }
  return viewportsOrFn;
}

/**
 * 创建与 viewports Map 绑定的 UI 侧渲染钩子
 * @description
 * AOM 不再直接访问 board.viewports，而是通过这组钩子间接发起到各 viewport 的渲染请求。
 * `viewports` 参数支持传入直接的 Map 引用或返回 Map 的惰性函数（适合 Board 构造时 viewports 尚未就绪的场景）。
 *
 * @param {Map<string, import("./viewport.js").Viewport> | (() => Map<string, import("./viewport.js").Viewport>)} viewportsOrFn - 视口 Map 或惰性获取函数
 * @returns {import("../../worker/components/orchestration/aom-render-hooks.js").AomRenderHooks
 */
function createBoardRenderHooks(viewportsOrFn) {
  /**
   * 获取当前 viewports Map
   * @returns {Map<string, import("./viewport.js").Viewport> | undefined}
   */
  const getViewports = () => _resolveViewports(viewportsOrFn);

  return {
    /**
     * 刷新所有 viewport 的活动层
     * @param {import("../../objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
     */
    requestLiveRender(objectInstances = []) {
      const viewports = getViewports();
      if (!viewports?.size) return;

      for (const viewport of viewports.values()) {
        const liveRenderer = viewport?.liveRenderer;
        if (!liveRenderer) continue;

        const targetObjects =
          objectInstances.length > 0
            ? objectInstances
            : (liveRenderer.collectActiveDrawables?.() ?? []);

        if (typeof liveRenderer.invalidateObjects === "function") {
          liveRenderer.invalidateObjects(targetObjects);
        }
        viewport?.requestViewportUiRender?.();
      }
    },

    /**
     * 刷新所有 viewport 的静态层
     * @param {Object[]} chunks - 需要刷新的区块
     */
    requestBaseRender(chunks = []) {
      const viewports = getViewports();
      if (!viewports?.size) return;

      for (const viewport of viewports.values()) {
        if (chunks.length > 0) {
          viewport?.baseRenderer?.invalidateChunks?.(chunks);
          continue;
        }
        if (typeof viewport?.requestViewportBaseRender === "function") {
          viewport.requestViewportBaseRender();
          continue;
        }
        viewport?.baseRenderer?.flush?.();
      }
    },

    /**
     * 按对象范围刷新 viewport 的静态层
     * @param {import("../../objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
     * @param {Object[]} fallbackChunks - 回退区块
     * @param {Map<number, RectangleRange>} previousWorldRects - 旧世界范围快照
     */
    requestBaseRenderForObjects(
      objectInstances = [],
      fallbackChunks = [],
      previousWorldRects = new Map(),
    ) {
      const viewports = getViewports();
      if (!viewports?.size) return;

      for (const viewport of viewports.values()) {
        const dirtyRects = viewport?.baseRenderer?.invalidateObjects?.(
          objectInstances,
          { previousWorldRects },
        );

        if (Array.isArray(dirtyRects) && dirtyRects.length > 0) {
          viewport?.syncChunkBufferWithViewport?.();
          continue;
        }

        if (fallbackChunks.length > 0) {
          viewport?.baseRenderer?.invalidateChunks?.(fallbackChunks);
          continue;
        }

        if (typeof viewport?.requestViewportBaseRender === "function") {
          viewport.requestViewportBaseRender();
          continue;
        }

        viewport?.baseRenderer?.flush?.();
      }
    },

    /**
     * 刷新能看到指定对象集合的那些 viewport 的视口
     * @param {import("../../objects/basic-obj.js").BasicObject[]} objectInstances - 对象实例
     */
    flushViewportForObjects(objectInstances = []) {
      const viewports = getViewports();
      if (!viewports?.size) return;

      const worldRanges = objectInstances
        .map((obj) => {
          const range =
            typeof obj.getRange === "function" ? obj.getRange() : undefined;
          if (!range || typeof range.withPosition !== "function") return null;
          const positioned = range.withPosition(obj.position);
          return positioned ? RectangleRange.from(positioned) : null;
        })
        .filter(Boolean);

      if (worldRanges.length === 0) return;

      for (const viewport of viewports.values()) {
        const viewportWorldRect = viewport.getViewportWorldRect?.();
        if (!viewportWorldRect) continue;

        const intersects = worldRanges.some((worldRange) =>
          intersectsRanges(viewportWorldRect, worldRange),
        );
        if (intersects) {
          viewport.flushViewportRender?.();
        }
      }
    },
  };
}

export { createBoardRenderHooks };
