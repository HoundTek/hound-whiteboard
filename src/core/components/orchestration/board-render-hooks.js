/**
 * @file 白板 UI 渲染钩子工厂
 * @description
 * 创建与 UI 侧 monitor/renderer 连通的 AOM render hooks 实现。
 * AOM 通过这组钩子间接发起到各 monitor 的渲染请求，不再直接访问 board.monitors。
 * @module core/components/orchestration/board-render-hooks
 * @author Zhou Chenyu
 */

import { RectangleRange, intersectsRanges } from "../../range/index.js";

/**
 * 解析 monitors 引用
 * @param {Map<string, import("./monitor-proxy.js").MonitorProxy> | (() => Map<string, import("./monitor-proxy.js").MonitorProxy>)} monitorsOrFn - monitors Map 或返回 Map 的函数
 * @returns {Map<string, import("./monitor-proxy.js").MonitorProxy> | undefined}
 */
function _resolveMonitors(monitorsOrFn) {
  if (typeof monitorsOrFn === "function") {
    return monitorsOrFn();
  }
  return monitorsOrFn;
}

/**
 * 创建与 monitors Map 绑定的 UI 侧渲染钩子
 * @description
 * AOM 不再直接访问 board.monitors，而是通过这组钩子间接发起到各 monitor 的渲染请求。
 * `monitors` 参数支持传入直接的 Map 引用或返回 Map 的惰性函数（适合 Board 构造时 monitors 尚未就绪的场景）。
 *
 * @param {Map<string, import("./monitor-proxy.js").MonitorProxy> | (() => Map<string, import("./monitor-proxy.js").MonitorProxy>)} monitorsOrFn - 显示器 Map 或惰性获取函数
 * @param {() => import("../../objects/basic-obj.js").BasicObject[]} [collectAllActiveDrawables] - 收集所有活跃可绘制对象的函数（可选）
 * @returns {import("./aom-render-hooks.js").AomRenderHooks}
 */
function createBoardRenderHooks(monitorsOrFn, collectAllActiveDrawables) {
  /**
   * 获取当前 monitors Map
   * @returns {Map<string, import("./monitor-proxy.js").MonitorProxy> | undefined}
   */
  const getMonitors = () => _resolveMonitors(monitorsOrFn);

  return {
    /**
     * 刷新所有 monitor 的活动层
     * @param {import("../../objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
     */
    requestLiveRender(objectInstances = []) {
      const monitors = getMonitors();
      if (!monitors?.size) return;

      for (const monitor of monitors.values()) {
        const liveRenderer = monitor?.liveRenderer;
        if (!liveRenderer) continue;

        const targetObjects =
          objectInstances.length > 0
            ? objectInstances
            : (liveRenderer.collectActiveDrawables?.() ?? []);

        if (typeof liveRenderer.invalidateObjects === "function") {
          liveRenderer.invalidateObjects(targetObjects);
        }
        monitor?.requestViewportUiRender?.();
      }
    },

    /**
     * 刷新所有 monitor 的静态层
     * @param {import("../chunk/chunk.js").Chunk[]} chunks - 需要刷新的区块
     */
    requestBaseRender(chunks = []) {
      const monitors = getMonitors();
      if (!monitors?.size) return;

      for (const monitor of monitors.values()) {
        if (chunks.length > 0) {
          monitor?.baseRenderer?.invalidateChunks?.(chunks);
          continue;
        }
        if (typeof monitor?.requestViewportBaseRender === "function") {
          monitor.requestViewportBaseRender();
          continue;
        }
        monitor?.baseRenderer?.flush?.();
      }
    },

    /**
     * 按对象范围刷新 monitor 的静态层
     * @param {import("../../objects/basic-obj.js").BasicObject[]} objectInstances - 受影响对象
     * @param {import("../chunk/chunk.js").Chunk[]} fallbackChunks - 回退区块
     * @param {Map<number, RectangleRange>} previousWorldRects - 旧世界范围快照
     */
    requestBaseRenderForObjects(
      objectInstances = [],
      fallbackChunks = [],
      previousWorldRects = new Map(),
    ) {
      const monitors = getMonitors();
      if (!monitors?.size) return;

      for (const monitor of monitors.values()) {
        const dirtyRects = monitor?.baseRenderer?.invalidateObjects?.(
          objectInstances,
          { previousWorldRects },
        );

        if (Array.isArray(dirtyRects) && dirtyRects.length > 0) {
          monitor?.syncChunkBufferWithViewport?.();
          continue;
        }

        if (fallbackChunks.length > 0) {
          monitor?.baseRenderer?.invalidateChunks?.(fallbackChunks);
          continue;
        }

        if (typeof monitor?.requestViewportBaseRender === "function") {
          monitor.requestViewportBaseRender();
          continue;
        }

        monitor?.baseRenderer?.flush?.();
      }
    },

    /**
     * 刷新能看到指定对象集合的那些 monitor 的视口
     * @param {import("../../objects/basic-obj.js").BasicObject[]} objectInstances - 对象实例
     */
    flushViewportForObjects(objectInstances = []) {
      const monitors = getMonitors();
      if (!monitors?.size) return;

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

      for (const monitor of monitors.values()) {
        const viewportWorldRect = monitor.getViewportWorldRect?.();
        if (!viewportWorldRect) continue;

        const intersects = worldRanges.some((worldRange) =>
          intersectsRanges(viewportWorldRect, worldRange),
        );
        if (intersects) {
          monitor.flushViewportRender?.();
        }
      }
    },
  };
}

export { createBoardRenderHooks };
