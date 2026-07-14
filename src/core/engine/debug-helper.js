/**
 * @file Worker 侧调试辅助
 * @description 处理来自 UI 侧的 debug-request，将 Worker 内部状态输出到控制台。
 * @module core/engine/debug-helper
 * @author Zhou Chenyu
 */

import { Logger } from "../../utils/log/logger.js";
import { logBus } from "../../utils/log/log-bus.js";

/** @type {Logger} */
const debugLog = new Logger("DebugHelper", "DEBUG", logBus);

/**
 * 处理调试查询，输出到 Worker 控制台
 * @param {import("./components/orchestration/board-core.js").BoardCore} boardCore - BoardCore 实例
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
    default:
      debugLog.warn("unknown debug query:", query);
  }
}

/**
 * 输出所有区块加载状态
 * @param {import("./components/orchestration/board-core.js").BoardCore} boardCore
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
 * @param {import("./components/orchestration/board-core.js").BoardCore} boardCore
 * @returns {void}
 */
function logObjectLoadState(boardCore) {
  const loaded = Array.from(boardCore.objectLoaded.entries()).map(
    ([id, state]) => ({
      objectId: id,
      loadedCount: state?.loadedCount ?? 0,
      isActive:
        boardCore.activeObjectManager?.activeObjectIndex?.has?.(id) ?? false,
      coveredChunkIds: [...(boardCore.getObjectCoverChunks(id) ?? [])].sort(
        (a, b) => a - b,
      ),
    }),
  );
  debugLog.debug("objectLoadState:", loaded);
}

/**
 * 输出 AOM 各层详情
 * @param {import("./components/orchestration/board-core.js").BoardCore} boardCore
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
 * @param {import("./components/orchestration/board-core.js").BoardCore} boardCore
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
 * @param {import("./components/orchestration/board-core.js").BoardCore} boardCore
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

  const aom = boardCore.activeObjectManager;
  const details = ids.map((objectId) => {
    const obj = boardCore.getObjectById(Number(objectId));
    if (!obj) return { objectId, error: "not found" };

    return {
      id: obj.id,
      type: obj.constructor.name,
      isActive: aom?.activeObjectIndex?.has?.(obj.id) ?? false,
      position: { x: obj.position.x, y: obj.position.y },
      transform: obj.transform
        ? {
            a: obj.transform.a,
            b: obj.transform.b,
            c: obj.transform.c,
            d: obj.transform.d,
          }
        : undefined,
      boundingBox: obj.rich?.boundingBox,
      range: obj.getRange(),
      property: { ...(obj.property ?? {}) },
      data: { ...(obj.data ?? {}) },
      loadedCount: boardCore.getObjectLoadCount(obj.id),
      coveredChunkIds: [...(boardCore.getObjectCoverChunks(obj.id) ?? [])].sort(
        (a, b) => a - b,
      ),
    };
  });

  debugLog.debug("objectsDetail:", details);
}

/**
 * 输出 Worker 侧 BoardCore 摘要
 * @param {import("./components/orchestration/board-core.js").BoardCore} boardCore
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

export { handleDebugQuery };
