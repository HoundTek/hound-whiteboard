/**
 * @file 调试工具
 * @description 提供基于键盘信号的白板调试查询能力。
 * @module core/tools/debugger-tool
 * @author Zhou Chenyu
 */

import { Tool } from "../../core/tools/tool.js";
import { dagToMermaid } from "../../core/devices-dag/index.js";
import { Logger } from "../../utils/log/logger.js";
import { logBus } from "../../utils/log/log-bus.js";

class DebuggerTool extends Tool {
  /** @type {Logger} */
  #log = new Logger("Debugger", "INFO", logBus);
  process(signalPacket, deviceContext = {}) {
    const board = deviceContext?.acc?.board;
    if (!board) {
      this.#log.warn("missing board context", signalPacket);
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
        case "debug:devices":
          this.logDevicesDAG(board);
          break;
        case "debug:mermaid":
          this.logMermaidDevicesDAG(board);
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
            this.#log.warn(
              "unsupported debug command:",
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

  /**
   * AOM 在 Worker 侧，UI 侧不直接持有
   * @param {import("../../core/components/orchestration/board.js").Board} board
   * @returns {{ activeObjectIds: Set<number> }}
   * @private
   */
  #resolveActiveObjectIds(board) {
    return new Set(
      Array.from(board.activeObjectManager?.activeObjectIndex?.keys?.() ?? []),
    );
  }

  summarizeObjectLoad(board) {
    const activeObjectIds = this.#resolveActiveObjectIds(board);
    const loadedObjects = Array.from(board.objectLoaded.entries()).map(
      ([objectId, objectState]) => {
        const obj = objectState?.obj;
        const candidateChunkIds = [];

        return {
          objectId,
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
    const activeObjectIds = Array.from(this.#resolveActiveObjectIds(board));
    const viewportIds = Array.from(board.viewports?.keys?.() ?? []);

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
      viewportCount: viewportIds.length,
      viewportIds,
      rootChunkLoader: this.cloneSnapshot(board.rootChunkLoader),
    };
  }

  logChunkLoad(board) {
    this.#log.info("chunk load summary:", this.summarizeChunkLoad(board));
  }

  logObjectLoad(board) {
    this.#log.info("object load summary:", this.summarizeObjectLoad(board));
  }

  stringifyDevicesDAG(dag) {
    if (!dag || typeof dag.toString !== "function") {
      return "<no devices dag>";
    }
    return dag.toString();
  }

  mermaidizeDevicesDAG(dag, options = {}) {
    if (!dag) {
      return "<no devices dag>";
    }
    return dagToMermaid(dag, options);
  }

  logDevicesDAG(board) {
    const devicesDAG = board.devicesDAG;
    if (!devicesDAG) {
      this.#log.warn("missing devices dag", board);
      return;
    }

    this.#log.info("devices dag:\n" + this.stringifyDevicesDAG(devicesDAG));
  }

  logMermaidDevicesDAG(board) {
    const devicesDAG = board.devicesDAG;
    if (!devicesDAG) {
      this.#log.warn("missing devices dag", board);
      return;
    }

    this.#log.info(
      "devices dag in Mermaid format:\n" +
        this.mermaidizeDevicesDAG(devicesDAG, { orientation: "TD" }),
    );
  }

  logChunk(board, chunkId) {
    if (chunkId === undefined || chunkId === null) {
      this.#log.warn("debug:chunk requires context.id");
      return;
    }

    const chunk = board.getChunkById(Number(chunkId));
    if (!chunk) {
      this.#log.warn("chunk %s not found", chunkId);
      return;
    }

    this.#log.info(
      `chunk ${chunkId} summary:`,
      this.summarizeChunk(chunk, board.chunkLoaded.get(chunk.id)),
    );
  }

  logActiveObjectManager(board) {
    const activeObjectIds = this.#resolveActiveObjectIds(board);
    const activeObjects = Array.from(activeObjectIds);

    this.#log.info("activeObjectManager summary:", {
      note: "AOM lives on Worker side; UI only sees activeObjectIndex keys",
      activeObjectCount: activeObjects.length,
      activeObjectIds: activeObjects,
    });
  }

  logBoard(board) {
    this.#log.info("board summary:", this.summarizeBoard(board));
  }
}

export { DebuggerTool };
