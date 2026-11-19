/**
 * @file 撤销/重做过渡记录
 * @description 解析 undo/redo 目标，收集过渡会触及的记录与区块，供效果应用前准备驻留。
 * @module kernel/api/undo-transition
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { deserialize } from "../objects/object-deserializer.js";
import { OPERATION_TYPES } from "../hit/operation.js";
import { RectangleRange } from "../range/index.js";
import { ChunkObjectManager } from "../chunk/chunk-object-manager.js";

/**
 * 解析撤销目标
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @param {string} [targetNodeId] - 显式撤销目标；缺省按本端来源取活动链最近节点
 * @returns {string|null} 目标节点 shareId；无可撤销目标时为 null
 */
function resolveUndoTarget(boardCore, targetNodeId) {
  const tree = boardCore.undoTree;
  if (tree.head === tree.root) return null;
  let targetId = targetNodeId ?? null;
  if (targetId === null) {
    const source = boardCore.hitCommitter.source;
    const log = boardCore.operationLog;
    const chain = tree.getActiveChain();
    for (let i = chain.length - 1; i >= 0; i--) {
      if (log.get(chain[i].shareId)?.source === source) {
        targetId = chain[i].shareId;
        break;
      }
    }
  }
  if (targetId === null || !tree.isOnActiveChain(targetId)) return null;
  return targetId;
}

/**
 * 取节点成员记录
 * @param {Object} log - 操作日志
 * @param {Object} node - 分子节点
 * @returns {Object[]} 记录数组
 */
function recordsOfNode(log, node) {
  return node.memberIds.map((id) => log.get(id)).filter(Boolean);
}

/**
 * 收集撤销会回退的记录
 * @description 取活动链中目标节点及其后的全部成员记录；保守地多取是安全的。
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @param {string} [targetNodeId] - 显式撤销目标
 * @returns {Object[]} 将被回退的记录
 */
function collectUndoTransitionRecords(boardCore, targetNodeId) {
  const targetId = resolveUndoTarget(boardCore, targetNodeId);
  if (targetId === null) return [];
  const chain = boardCore.undoTree.getActiveChain();
  const index = chain.findIndex((node) => node.shareId === targetId);
  if (index === -1) return [];
  const log = boardCore.operationLog;
  return chain.slice(index).flatMap((node) => recordsOfNode(log, node));
}

/**
 * 收集重做会重新应用的记录
 * @description 撤销目标节点可能不在活动链上，取该节点及其子树；保守地多取是安全的。
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @returns {Object[]} 将被重放的记录
 */
function collectRedoTransitionRecords(boardCore) {
  const tree = boardCore.undoTree;
  const target = tree.getRedoTargetForSource(boardCore.hitCommitter.source);
  if (target === null) return [];
  const node = tree.findNode(target.targetId);
  if (!node) return [];
  const log = boardCore.operationLog;
  const records = [];
  const walk = (current) => {
    records.push(...recordsOfNode(log, current));
    for (const child of tree.getChildrenOf(current)) walk(child);
  };
  walk(node);
  return records;
}

/**
 * 计算对象当前的世界坐标包围矩形
 * @param {import("../objects/basic-obj.js").BasicObject} obj - 对象实例
 * @returns {import("../range/index.js").RectangleRange | null} 世界包围矩形
 */
function getObjectWorldRect(obj) {
  if (!obj?.position) return null;
  const range = obj.getRange();
  if (!range) return null;
  return RectangleRange.from(range.withPosition(obj.position));
}

/**
 * 收集撤销/重做/MOVE_HEAD 记录会触及的成员记录
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @param {Object[]} records - 到达记录
 * @returns {Object[]} 被回放的成员记录
 */
function collectRecordsAffectedByTreeOperations(boardCore, records) {
  const tree = boardCore.undoTree;
  const log = boardCore.operationLog;
  const affected = [];
  const collectNode = (nodeId) => {
    if (typeof nodeId !== "string") return;
    const node = tree.findNode(nodeId);
    if (!node) return;
    affected.push(...recordsOfNode(log, node));
  };

  for (const record of records) {
    if (
      record.type === OPERATION_TYPES.UNDO ||
      record.type === OPERATION_TYPES.MOVE_HEAD
    ) {
      collectNode(record.payload?.targetNodeId);
    } else if (record.type === OPERATION_TYPES.REDO) {
      const undoRecord = log.get(record.payload?.targetUndoId);
      collectNode(undoRecord?.payload?.targetNodeId);
    }
  }

  return affected;
}

/**
 * 收集记录点名的区块
 * @description 取 payload 的 chunkId/chunks、对象覆盖索引，以及 ADD/DELETE/MODIFY
 * 快照几何覆盖的区块；供回放或撤销前做区块级 FullLoad。
 * @param {import("../board/board-core.js").BoardCore} boardCore - 板核心
 * @param {Object[]} records - 分子操作记录
 * @returns {Set<number>} 区块 id 集合
 */
function collectRecordChunkIds(boardCore, records) {
  const chunkIds = new Set();
  const addChunkId = (value) => {
    const chunkId = Number(value);
    if (Number.isInteger(chunkId) && chunkId > 0) chunkIds.add(chunkId);
  };
  const addChunksEntries = (entries) => {
    for (const entry of entries ?? []) addChunkId(entry?.chunkId);
  };
  const addSnapshotCover = (snapshot) => {
    if (snapshot === undefined || snapshot === null) return;
    if (boardCore.width <= 0 || boardCore.height <= 0) return;
    let obj;
    try {
      obj = deserialize(snapshot);
    } catch {
      return;
    }
    const rect = getObjectWorldRect(obj);
    if (!rect) return;
    for (const chunkId of ChunkObjectManager.calculateCoveredChunkIdsForRange(
      rect,
      boardCore.width,
      boardCore.height,
    )) {
      chunkIds.add(chunkId);
    }
  };

  const collectRecord = (record) => {
    const payload = record?.payload ?? {};
    addChunkId(payload.chunkId);
    const chunks = payload.chunks;
    if (Array.isArray(chunks)) {
      addChunksEntries(chunks);
    } else if (chunks && typeof chunks === "object") {
      addChunksEntries(chunks.before);
      addChunksEntries(chunks.after);
    }
    if (typeof payload.objectId === "string") {
      for (const chunkId of boardCore.getObjectCoverChunks(payload.objectId) ??
        []) {
        chunkIds.add(chunkId);
      }
    }
    switch (record?.type) {
      case OPERATION_TYPES.ADD_OBJECT:
      case OPERATION_TYPES.DELETE_OBJECT:
        addSnapshotCover(payload.data);
        break;
      case OPERATION_TYPES.MODIFY_OBJECT:
        addSnapshotCover(payload.before);
        addSnapshotCover(payload.after);
        break;
      default:
        break;
    }
  };

  for (const record of records) collectRecord(record);
  for (const record of collectRecordsAffectedByTreeOperations(
    boardCore,
    records,
  )) {
    collectRecord(record);
  }

  return chunkIds;
}

export {
  resolveUndoTarget,
  collectUndoTransitionRecords,
  collectRedoTransitionRecords,
  collectRecordsAffectedByTreeOperations,
  collectRecordChunkIds,
};
