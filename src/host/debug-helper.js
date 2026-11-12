/**
 * @file Worker 侧调试辅助
 * @description 处理来自 UI 侧的 debug-request，将 Worker 内部状态输出到控制台。
 * @module host/debug-helper
 * @author Zhou Chenyu
 */

import { Logger } from "../utils/log/logger.js";
import { logBus } from "../utils/log/log-bus.js";
import { buildObjectDetails } from "../kernel/api/object-summary.js";

/** @type {Logger} */
const debugLog = new Logger("DebugHelper", "DEBUG", logBus);

/**
 * 处理调试查询，输出到 Worker 控制台
 * @param {import("../kernel/board/board-core.js").BoardCore} boardCore - BoardCore 实例
 * @param {string} query - 调试查询名
 * @param {{ chunkIds?: number[], [key: string]: any }} [params={}] - 查询参数
 * @returns {void}
 */
function handleDebugQuery(boardCore, query, params = {}) {
  switch (query) {
    case "chunkLoadState":
      return logChunkLoadState(boardCore);
    case "objectLoadState":
      return logObjectLoadState(boardCore);
    case "aomState":
      return logAomState(boardCore);
    case "chunksDetail":
      return logChunksDetail(boardCore, params.chunkIds);
    case "objectsDetail":
      return logObjectsDetail(boardCore, params);
    case "boardState":
      return logBoardState(boardCore);
    case "hitState":
      return logHitState(boardCore);
    default:
      debugLog.warn("unknown debug query:", query);
  }
}

/**
 * 输出所有区块加载状态
 * @param {import("../kernel/board/board-core.js").BoardCore} boardCore
 * @returns {void}
 */
function logChunkLoadState(boardCore) {
  const loaded = Array.from(boardCore.chunkLoaded.entries()).map(
    ([id, state]) => ({
      chunkId: id,
      tempLoadedCount: state?.tempLoadedCount ?? 0,
      fullLoadedCount: state?.fullLoadedCount ?? 0,
    }),
  );
  debugLog.debug("chunkLoadState:", loaded);
}

/**
 * 输出所有对象加载状态
 * @param {import("../kernel/board/board-core.js").BoardCore} boardCore
 * @returns {void}
 */
function logObjectLoadState(boardCore) {
  const loaded = Array.from(boardCore.objectLoaded.entries()).map(
    ([id, state]) => ({
      objectId: id,
      loadedCount: state?.loadedCount ?? 0,
      isActive:
        boardCore.activeObjectManager?.isActive?.(id) ?? false,
      coveredChunkIds: [...(boardCore.getObjectCoverChunks(id) ?? [])].sort(
        (a, b) => a - b,
      ),
    }),
  );
  debugLog.debug("objectLoadState:", loaded);
}

/**
 * 输出 AOM 各层详情
 * @param {import("../kernel/board/board-core.js").BoardCore} boardCore
 * @returns {void}
 */
function logAomState(boardCore) {
  const aom = boardCore.activeObjectManager;
  if (!aom) {
    debugLog.warn("aomState: no AOM");
    return;
  }

  const layers = aom.layerOrder.map((layer) => ({
    layerId: layer.id,
    active: layer.active,
    activeObjects: [...layer.activeObjects].sort((a, b) => a - b),
    inactiveGraph: layer.inactiveGraph.toArray(),
  }));

  const allActiveIds = Array.from(aom.activeObjectIndex.keys()).sort(
    (a, b) => a - b,
  );

  debugLog.debug("aomState:", {
    layers,
    allActiveIds,
  });
}

/**
 * 输出区块静态图详情
 * @description 若 chunkIds 为空或未提供，则输出所有已加载区块的详情。
 * @param {import("../kernel/board/board-core.js").BoardCore} boardCore
 * @param {number[]} [chunkIds] - 区块 id 列表
 * @returns {void}
 */
function logChunksDetail(boardCore, chunkIds) {
  let ids;
  if (chunkIds == null || (Array.isArray(chunkIds) && chunkIds.length === 0)) {
    ids = Array.from(boardCore.chunkLoaded.keys()).sort((a, b) => a - b);
  } else {
    ids = (Array.isArray(chunkIds) ? chunkIds : [chunkIds]).filter(
      (id) => id != null,
    );
  }

  const details = ids.map((chunkId) => {
    const chunk = boardCore.getChunkById(Number(chunkId));
    if (!chunk) {
      return { chunkId, error: "not found" };
    }

    const staticGraph = chunk.objectManager?.staticGraph;
    return {
      chunkId: chunk.id,
      x: chunk.x,
      y: chunk.y,
      isLoad: chunk.isLoad,
      isTempLoad: chunk.isTempLoad,
      staticGraph: staticGraph?.toArray?.() ?? [],
    };
  });

  debugLog.debug("chunksDetail:", details);
}

/**
 * 输出对象详情
 * @description 按 objectIds 或 chunkIds 查询；都不传则输出所有已加载对象。
 * @param {import("../kernel/board/board-core.js").BoardCore} boardCore
 * @param {{ objectIds?: number[], chunkIds?: number[] }} params - 查询参数
 * @returns {void}
 */
function logObjectsDetail(boardCore, params = {}) {
  const { objectIds, chunkIds } = params;

  let ids;
  if (Array.isArray(objectIds) && objectIds.length > 0) {
    ids = objectIds;
  } else if (Array.isArray(chunkIds) && chunkIds.length > 0) {
    const seen = new Set();
    for (const chunkId of chunkIds) {
      const chunk = boardCore.getChunkById(Number(chunkId));
      if (!chunk?.objectManager?.staticGraph) continue;
      for (const nodeId of chunk.objectManager.staticGraph.getNodes()) {
        seen.add(nodeId);
      }
    }
    ids = [...seen];
  } else {
    ids = Array.from(boardCore.objectLoaded.keys());
  }

  const details = ids.map((objectId) => {
    const obj = boardCore.getObjectById(objectId);
    if (!obj) return { objectId, error: "not found" };
    // 与 BoardApi.queryObjectDetails 共用同一构建器，避免调试输出与接口字段漂移
    return buildObjectDetails(boardCore, obj);
  });

  debugLog.debug("objectsDetail:", details);
}

/**
 * 输出 Worker 侧 BoardCore 摘要
 * @param {import("../kernel/board/board-core.js").BoardCore} boardCore
 * @returns {void}
 */
function logBoardState(boardCore) {
  const aom = boardCore.activeObjectManager;
  debugLog.debug("boardState:", {
    width: boardCore.width,
    height: boardCore.height,
    rootPath: boardCore.rootPath,
    chunkIds: [...boardCore.chunkLoaded.keys()].sort((a, b) => a - b),
    objectIds: [...boardCore.objectLoaded.keys()].sort((a, b) => a - b),
    activeObjectCount: aom?.activeObjectIndex?.size ?? 0,
  });
}

/** hitState 转储序号（防 DevTools 相邻重复消息合并） @type {number} */
let hitDumpSeq = 0;

/**
 * 输出 hit 全景：时间回溯树、操作日志（by id）、对象状态（by id）、操作数据（id → data）
 * @description 四部分合并为单条原子输出，避免多条独立输出在控制台被分流或合并。
 * @param {import("../kernel/board/board-core.js").BoardCore} boardCore
 * @returns {void}
 */
function logHitState(boardCore) {
  const tree = boardCore.undoTree;
  const log = boardCore.operationLog;
  if (!tree || !log) {
    debugLog.warn("hitState: no undo tree or operation log");
    return;
  }

  // 树形结构（缩进文本）：活动链节点标 *，HEAD 标 <<<
  const activeNodes = new Set(tree.getActiveChain());
  const treeLines = [];
  const walk = (node, depth) => {
    if (node.record !== null) {
      const headMark = node === tree.head ? " <<< HEAD" : "";
      const members = log.getSupraMembers(node.shareId);
      const supraMark = members.length > 1 ? ` (超分子×${members.length})` : "";
      treeLines.push(
        `${"  ".repeat(depth)}${activeNodes.has(node) ? "*" : "-"} ${node.shareId}${supraMark}${headMark}`,
      );
    } else {
      treeLines.push("root");
    }
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  };
  walk(tree.root, 0);

  // 操作日志（by id）
  const logById = {};
  for (const record of log.toArray()) {
    logById[record.id] = {
      type: record.type,
      source: record.source,
      time: record.time,
      parentId: record.parentId,
      supraOpId: record.supraOpId,
      payload: record.payload,
    };
  }

  // 对象状态（by id）
  const aom = boardCore.activeObjectManager;
  const stateById = {};
  for (const [id] of boardCore.objectLoaded) {
    const obj = boardCore.getObjectById(id);
    stateById[id] = {
      type: obj?.constructor?.name,
      isActive: aom?.isActive?.(id) ?? false,
      inTrash: boardCore.trash?.has?.(id) ?? false,
    };
  }

  // 操作数据（id → data）
  const dataById = {};
  for (const record of log.toArray()) {
    dataById[record.id] =
      record.payload?.data ??
      record.payload?.after ??
      record.payload?.before ??
      null;
  }

  hitDumpSeq += 1;
  debugLog.debug(
    `hitState #${hitDumpSeq}: 时间回溯树（* 活动链）\n${treeLines.join("\n")}\n`,
    {
      "日志 (by id)": logById,
      "对象状态 (by id)": stateById,
      "操作数据 (id → data)": dataById,
    },
  );
}

export { handleDebugQuery };
