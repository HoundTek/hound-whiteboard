// SPDX-License-Identifier: MIT

/**
 * @file 对象摘要与详情构建
 * @description 统一 BoardApi 查询面与 Worker 调试辅助的字段口径，避免两处各自拼装导致漂移。
 * @module kernel/api/object-summary
 * @author Zhou Chenyu
 */

/**
 * 构建对象摘要
 * @description
 * 只返回纯数据，且不包含任何随几何复杂度增长的大字段：
 * 摘要会在框选、手势 `hit:changed`、远程选择刷新等高频路径上跨 worker 边界，
 * 带一条笔迹的点数组就足以让单次消息放大到几十 KB。
 *
 * 刻意不返回：
 * - `data` / `property`：无消费方读取，需要时走详情查询
 * - `range`：主判定范围是类实例，结构化克隆后方法丢失，跨端消费方只能退回 `boundingBox`，
 *   返回它等于让同进程路径与跨端路径的判定口径不一致
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @param {import("../objects/basic-obj.js").BasicObject} obj - 目标对象
 * @returns {import("../types/types.js").ObjectSummary} 对象摘要
 */
function buildObjectSummary(boardCore, obj) {
  const aom = boardCore.activeObjectManager;
  return {
    id: obj.id,
    type: obj.constructor.name,
    isActive: aom?.isActive?.(obj.id) ?? false,
    choice: aom?.choiceOf?.(obj.id),
    position: { x: obj.position.x, y: obj.position.y },
    transform: {
      a: obj.transform.a,
      b: obj.transform.b,
      c: obj.transform.c,
      d: obj.transform.d,
    },
    boundingBox: obj.rich?.boundingBox,
  };
}

/**
 * 构建对象详情
 * @description
 * 摘要是高频路径的瘦返回体，详情是调试与命令行诊断用的胖返回体：
 * 额外带回几何数据快照、属性快照、引用计数与覆盖区块。
 * 只在显式诊断入口调用（CLI `show`、调试查询），不得放进高频路径。
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @param {import("../objects/basic-obj.js").BasicObject} obj - 目标对象
 * @returns {import("../types/types.js").ObjectDetails} 对象详情
 */
function buildObjectDetails(boardCore, obj) {
  return {
    ...buildObjectSummary(boardCore, obj),
    property: { ...(obj.property ?? {}) },
    data: { ...(obj.data ?? {}) },
    loadedCount: boardCore.getObjectLoadCount(obj.id),
    coveredChunkIds: [...(boardCore.getObjectCoverChunks(obj.id) ?? [])].sort(
      (a, b) => a - b,
    ),
  };
}

export { buildObjectSummary, buildObjectDetails };
