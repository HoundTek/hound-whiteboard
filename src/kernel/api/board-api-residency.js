/**
 * @file Board API 路由驻留准备
 * @description 在 RPC 路由调用前按参数确保对象/区块已驻留，并在调用后释放临时加载。
 * @module kernel/api/board-api-residency
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { BOARD_API_ROUTES } from "./board-api-routes.js";
import {
  collectRecordChunkIds,
  collectRedoTransitionRecords,
  collectUndoTransitionRecords,
} from "./undo-transition.js";

/**
 * 需要按对象 id 准备驻留的 route
 * @type {Record<string, (params: Object) => string[]|undefined>}
 */
const OBJECT_ROUTES = {
  queryObject: (params) => [params.objectId],
  queryObjects: (params) => params.ids,
  queryObjectDetails: (params) => params.ids,
  deleteObjects: (params) => params.objectIds,
  addActiveObjects: (params) => params.objectIds,
  discardActiveObjects: (params) => params.objectIds,
  commitObjects: (params) => params.objectIds,
  modifyObject: (params) => [params.objectId],
  modifyObjects: (params) =>
    (params.patches ?? []).map((entry) => entry?.objectId),
  appendListItem: (params) => [params.objectId],
  replaceListItem: (params) => [params.objectId],
  removeListItem: (params) => [params.objectId],
};

/**
 * 为过渡记录准备区块驻留
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @param {Object[]} records - 过渡记录
 * @returns {Promise<(() => void)|null>} 释放函数；缓存/无需加载时为 null
 */
function ensureTransitionResident(boardCore, records) {
  if (records.length === 0) return Promise.resolve(null);
  const chunkIds = collectRecordChunkIds(boardCore, records);
  return boardCore.ensureChunksResident(
    [...chunkIds],
    "route-transition",
  );
}

/**
 * 按 route 准备驻留
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @param {string} route - RPC route 名
 * @param {Object} [params={}] - RPC 参数
 * @returns {Promise<(() => void)|null>} 临时 loader 的释放函数；缓存或无需加载时为 null
 */
async function prepareRouteResidency(boardCore, route, params = {}) {
  if (boardCore === null || boardCore === undefined) return null;
  if (typeof boardCore.memoryMode === "function" && boardCore.memoryMode()) {
    return null;
  }
  if (route === "queryObjectList") {
    await boardCore.ensureObjectTypeIndex();
    return null;
  }
  if (route === "queryChunkObjects") {
    await boardCore.ensureChunkMetadata(params.chunkIds ?? []);
    return null;
  }
  if (route === "undo") {
    return ensureTransitionResident(
      boardCore,
      collectUndoTransitionRecords(boardCore, params.targetNodeId),
    );
  }
  if (route === "redo") {
    return ensureTransitionResident(
      boardCore,
      collectRedoTransitionRecords(boardCore),
    );
  }
  if (route === "repairChainFromLog") {
    // 重建后的链可能包含旧链之外的记录；修复是低频路径，直接按全量日志准备区块
    return ensureTransitionResident(
      boardCore,
      boardCore.operationLog?.toJSON?.() ?? [],
    );
  }

  const resolveObjectIds = OBJECT_ROUTES[route];
  if (resolveObjectIds !== undefined) {
    const objectIds = resolveObjectIds(params) ?? [];
    return boardCore.ensureObjectsResident(objectIds, `route:${route}`);
  }
  return null;
}

/**
 * 调用 RPC route（先准备驻留，再执行，最后释放）
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @param {import("./board-api.js").BoardApi} api - BoardApi 实例
 * @param {string} route - RPC route 名
 * @param {Object} [params={}] - RPC 参数
 * @returns {Promise<*>} 调用结果
 */
async function invokeBoardApiRoute(boardCore, api, route, params = {}) {
  const entry = BOARD_API_ROUTES[route];
  if (!entry) {
    throw new Error(`未知 route：${route}`);
  }
  const release = await prepareRouteResidency(boardCore, route, params);
  try {
    return await entry.invoke(api, params);
  } finally {
    release?.();
  }
}

export {
  OBJECT_ROUTES,
  prepareRouteResidency,
  invokeBoardApiRoute,
};
