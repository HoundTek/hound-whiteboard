/**
 * @file AOM 渲染钩子
 * @description 定义 AOM 与渲染器之间的注入式 hook 接口，消除 ActiveObjectManager 对 monitor/renderer 的直接依赖。
 * @module core/components/orchestration/aom-render-hooks
 * @author Zhou Chenyu
 */

/**
 * AOM Render Hooks — 默认空实现
 * @description
 * 所有方法均为空操作。Board/UI 侧通过注入具体实现来接通实际渲染管线。
 * 这是 P0 解耦的关键适配层：AOM 不再直接访问 `board.monitors` 或 renderer。
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
     * 刷新活动层（live renderer）
     * @param {import("../../objects/basic-obj.js").BasicObject[]} _objectInstances - 受影响对象实例
     */
    requestLiveRender(_objectInstances = []) {},

    /**
     * 刷新静态层（base renderer）
     * @param {import("../chunk/chunk.js").Chunk[]} _chunks - 需要刷新的区块集合
     */
    requestBaseRender(_chunks = []) {},

    /**
     * 按对象范围刷新静态层
     * @param {import("../../objects/basic-obj.js").BasicObject[]} _objectInstances - 受影响对象
     * @param {import("../chunk/chunk.js").Chunk[]} _fallbackChunks - 无法走对象级失效时的回退区块
     * @param {Map<number, import("../../range/index.js").RectangleRange>} [_previousWorldRects] - 对象进入 AOM 前的世界范围快照
     */
    requestBaseRenderForObjects(
      _objectInstances = [],
      _fallbackChunks = [],
      _previousWorldRects = new Map(),
    ) {},

    /**
     * 刷新能看到指定对象集合的那些 monitor 的视口
     * @param {import("../../objects/basic-obj.js").BasicObject[]} _objectInstances - 对象实例
     */
    flushViewportForObjects(_objectInstances = []) {},
  };
}

export { createDefaultAomRenderHooks };
