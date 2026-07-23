/**
 * @file AOM 渲染钩子
 * @description 定义 AOM 与渲染器之间的注入式 hook 接口，消除 ActiveObjectManager 对 viewport/renderer 的直接依赖。
 * @module core/engine/orchestration/aom-render-hooks
 * @author Zhou Chenyu
 */

/**
 * AOM Render Hooks — 默认空实现
 * @description
 * 所有方法均为空操作。Board/UI 侧通过注入具体实现来接通实际渲染管线。
 * 这是 AOM 与渲染器的解耦适配层：AOM 不再直接访问 `board.viewports` 或 renderer。
 *
 * @example
 * ```js
 * const hooks = createDefaultAomRenderHooks();
 * const aom = new ActiveObjectManager(boardCore, { renderHooks: hooks });
 * ```
 * @returns {AomRenderHooks}
 */
function createDefaultAomRenderHooks() {
  return {
    /**
     * 刷新活动层（AOM 对象输出层）
     * @param {import("../objects/basic-obj.js").BasicObject[]} _objectInstances - 受影响对象实例
     */
    requestActiveRender(_objectInstances = []) {},

    /**
     * 刷新静态缓存层
     * @param {import("../chunk/chunk.js").Chunk[]} _chunks - 需要刷新的区块集合
     */
    requestStaticRender(_chunks = []) {},

    /**
     * 按对象范围刷新静态缓存层
     * @param {import("../objects/basic-obj.js").BasicObject[]} _objectInstances - 受影响对象
     * @param {import("../chunk/chunk.js").Chunk[]} _fallbackChunks - 无法走对象级失效时的回退区块
     * @param {Map<number, import("../range/index.js").RectangleRange>} [_previousWorldRects] - 对象进入 AOM 前的世界范围快照
     */
    requestStaticRenderForObjects(
      _objectInstances = [],
      _fallbackChunks = [],
      _previousWorldRects = new Map(),
    ) {},

    /**
     * 刷新能看到指定对象集合的那些 viewport 的视口
     * @param {import("../objects/basic-obj.js").BasicObject[]} _objectInstances - 对象实例
     */
    flushViewportForObjects(_objectInstances = []) {},
  };
}

export { createDefaultAomRenderHooks };
