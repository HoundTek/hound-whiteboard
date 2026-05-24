/**
 * @file 调试工具
 * @description 提供基于键盘信号的白板调试查询能力。
 * @module core/tools/debugger-tool
 * @author Zhou Chenyu
 */

import { Tool } from "../../core/tools/tool.js";

class DebuggerTool extends Tool {
  process(signalPacket, deviceContext = {}) {
    const board = deviceContext.board;
    if (!board) {
      console.warn("[debugger-tool] missing board context", signalPacket);
      return;
    }

    for (const signal of signalPacket.signals) {
      switch (signal.type) {
        case "debug:chunkload":
          this.logChunkLoad(board);
          break;
        case "debug:objectload":
          this.logObjectLoad(board);
          break;
        case "debug:chunk":
          this.logChunk(board, signal?.context?.id);
          break;
        case "debug:aom":
          this.logActiveObjectManager(board);
          break;
        case "debug:board":
          this.logBoard(board);
          break;
        default:
          if (
            typeof signal.type === "string" &&
            signal.type.startsWith("debug:")
          ) {
            console.warn(
              "[debugger-tool] unsupported debug command:",
              signal.type,
              signal.context,
            );
          }
          break;
      }
    }
  }

  reset() {}

  cloneSnapshot(value) {
    if (value === null || value === undefined || typeof value !== "object") {
      return value;
    }

    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (_) {
        // fall through to shallow snapshot
      }
    }

    if (Array.isArray(value)) {
      return value.slice();
    }

    if (value instanceof Map) {
      return new Map(value);
    }

    if (value instanceof Set) {
      return new Set(value);
    }

    const snapshot = {};
    for (const key of Object.keys(value)) {
      const property = value[key];
      if (typeof property === "function") continue;
      if (property && typeof property === "object") {
        if (Array.isArray(property)) {
          snapshot[key] = property.slice();
          continue;
        }
        if (property instanceof Map) {
          snapshot[key] = new Map(property);
          continue;
        }
        if (property instanceof Set) {
          snapshot[key] = new Set(property);
          continue;
        }
      }
      snapshot[key] = property;
    }
    snapshot.__constructor = value.constructor?.name ?? "Object";
    return snapshot;
  }

  serializeObjectCoverChunks(objectManager) {
    if (typeof objectManager?.serializeObjectCoverChunks === "function") {
      return objectManager.serializeObjectCoverChunks();
    }

    return Array.from(objectManager?.objectCoverChunks?.entries?.() ?? [])
      .map(([objectId, chunkIds]) => [
        objectId,
        Array.from(chunkIds ?? []).sort((left, right) => left - right),
      ])
      .sort((left, right) => left[0] - right[0]);
  }

  summarizeChunk(chunk, chunkState) {
    const objectManager = chunk?.objectManager;
    const staticGraph = objectManager?.staticGraph;
    const staticNodeIds = staticGraph?.getNodes?.() ?? [];

    return {
      chunk: this.cloneSnapshot(chunk),
      chunkState: this.cloneSnapshot(chunkState),
      chunkId: chunk?.id,
      coordinate:
        Number.isInteger(chunk?.x) && Number.isInteger(chunk?.y)
          ? { x: chunk.x, y: chunk.y }
          : undefined,
      isLoad: Boolean(chunk?.isLoad),
      isTempLoad: Boolean(chunk?.isTempLoad),
      neighborChunkIds: {
        left: chunk?.leftChunk?.id,
        right: chunk?.rightChunk?.id,
        up: chunk?.upChunk?.id,
        down: chunk?.downChunk?.id,
      },
      hasObjectManager: Boolean(objectManager),
      staticNodeCount: staticNodeIds.length,
      staticNodeIds,
      staticGraph: staticGraph?.toArray?.() ?? [],
      objectCoverChunkEntryCount: objectManager?.objectCoverChunks?.size ?? 0,
      objectCoverChunks: this.serializeObjectCoverChunks(objectManager),
    };
  }

  summarizeChunkLoad(board) {
    const loadedChunks = Array.from(board.chunkLoaded.entries()).map(
      ([chunkId, chunkState]) => ({
        chunkId,
        tempLoadedCount: chunkState?.tempLoadedCount ?? 0,
        fullLoadedCount: chunkState?.fullLoadedCount ?? 0,
        loaderStrategy: Array.from(
          chunkState?.loaderStrategy?.entries?.() ?? [],
        ),
        chunk: this.summarizeChunk(chunkState?.chunk, chunkState),
      }),
    );

    return {
      chunkCount: loadedChunks.length,
      loadedChunkIds: loadedChunks.map((entry) => entry.chunkId),
      tempLoadedChunkIds: loadedChunks
        .filter((entry) => entry.tempLoadedCount > 0)
        .map((entry) => entry.chunkId),
      fullLoadedChunkIds: loadedChunks
        .filter((entry) => entry.fullLoadedCount > 0)
        .map((entry) => entry.chunkId),
      totalTempLoadedCount: loadedChunks.reduce(
        (count, entry) => count + entry.tempLoadedCount,
        0,
      ),
      totalFullLoadedCount: loadedChunks.reduce(
        (count, entry) => count + entry.fullLoadedCount,
        0,
      ),
      loadedChunks,
    };
  }

  summarizeObjectLoad(board) {
    const activeObjectIds = new Set(
      Array.from(board.activeObjectManager?.activeObjectIndex?.keys?.() ?? []),
    );
    const loadedObjects = Array.from(board.objectLoaded.entries()).map(
      ([objectId, objectState]) => {
        const obj = objectState?.obj;
        const candidateChunkIds = Number.isInteger(obj?.ownerChunkId)
          ? [obj.ownerChunkId]
          : [];

        return {
          objectId,
          ownerChunkId: obj?.ownerChunkId,
          loadedCount: objectState?.loadedCount ?? 0,
          isActive: activeObjectIds.has(objectId),
          coveredChunkIds: Array.from(
            board.getObjectCoverChunks(objectId, candidateChunkIds),
          ).sort((left, right) => left - right),
          object: this.cloneSnapshot(obj),
        };
      },
    );

    return {
      objectCount: loadedObjects.length,
      loadedObjectIds: loadedObjects.map((entry) => entry.objectId),
      activeObjectIds: loadedObjects
        .filter((entry) => entry.isActive)
        .map((entry) => entry.objectId),
      retainedObjectIds: loadedObjects
        .filter((entry) => entry.loadedCount <= 0)
        .map((entry) => entry.objectId),
      loadedObjects,
    };
  }

  summarizeBoard(board) {
    const chunkEntries = Array.from(board.chunkLoaded.entries());
    const objectIds = Array.from(board.objectLoaded.keys?.() ?? []);
    const activeObjectIds = Array.from(
      board.activeObjectManager?.activeObjectIndex?.keys?.() ?? [],
    );
    const monitorIds = Array.from(board.monitors?.keys?.() ?? []);

    return {
      board: this.cloneSnapshot(board),
      persistenceMode: board.getPersistenceMode?.(),
      rootPath: board.rootPath,
      width: board.width,
      height: board.height,
      chunkCount: chunkEntries.length,
      loadedChunkIds: chunkEntries.map(([chunkId]) => chunkId),
      fullLoadedChunkIds: chunkEntries
        .filter(([, chunkState]) => (chunkState?.fullLoadedCount ?? 0) > 0)
        .map(([chunkId]) => chunkId),
      tempLoadedChunkIds: chunkEntries
        .filter(([, chunkState]) => (chunkState?.tempLoadedCount ?? 0) > 0)
        .map(([chunkId]) => chunkId),
      objectCount: objectIds.length,
      loadedObjectIds: objectIds,
      activeObjectCount: activeObjectIds.length,
      activeObjectIds,
      monitorCount: monitorIds.length,
      monitorIds,
      rootChunkLoader: this.cloneSnapshot(board.rootChunkLoader),
    };
  }

  logChunkLoad(board) {
    console.log(
      "[debugger-tool] chunk load summary:",
      this.summarizeChunkLoad(board),
    );
  }

  logObjectLoad(board) {
    console.log(
      "[debugger-tool] object load summary:",
      this.summarizeObjectLoad(board),
    );
  }

  logChunk(board, chunkId) {
    if (chunkId === undefined || chunkId === null) {
      console.warn("[debugger-tool] debug:chunk requires context.id");
      return;
    }

    const chunk = board.getChunkById(Number(chunkId));
    if (!chunk) {
      console.warn(`[debugger-tool] chunk ${chunkId} not found`);
      return;
    }

    console.log(
      `[debugger-tool] chunk ${chunkId} summary:`,
      this.summarizeChunk(chunk, board.chunkLoaded.get(chunk.id)),
    );
  }

  logActiveObjectManager(board) {
    const aom = board.activeObjectManager ?? {};
    const activeObjects = Array.from(aom.activeObjects ?? []).map(
      (obj) => obj.id,
    );
    const activeObjectIndexIds = Array.from(
      aom.activeObjectIndex?.keys?.() ?? [],
    );
    const layers = Array.from(aom.layerOrder ?? []).map((layer) => ({
      id: layer.id,
      activeObjects: Array.from(layer.activeObjects ?? []),
      inactiveNodes: layer.inactiveGraph?.getNodes?.() ?? [],
    }));
    const onLayer = Array.from(aom.onLayer?.entries?.() ?? []).map(
      ([objectId, layer]) => ({
        objectId,
        layerId: layer?.id,
      }),
    );

    console.log("[debugger-tool] activeObjectManager summary:", {
      manager: this.cloneSnapshot(aom),
      activeObjectCount: activeObjects.length,
      activeObjectIds: activeObjects,
      activeObjectIndexIds,
      layerCount: layers.length,
      layers,
      onLayer,
    });
  }

  logBoard(board) {
    console.log("[debugger-tool] board summary:", this.summarizeBoard(board));
  }
}

export { DebuggerTool };
