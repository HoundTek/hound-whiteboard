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
          if (typeof signal.type === "string" && signal.type.startsWith("debug:")) {
            console.warn("[debugger-tool] unsupported debug command:", signal.type, signal.context);
          }
          break;
      }
    }
  }

  reset() {
    // Debug tool 没有内部状态。
  }

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

  logChunkLoad(board) {
    const loadedChunks = Array.from(board.chunkLoaded.entries()).map(
      ([chunkId, chunkState]) => ({
        chunkId,
        isLoad: Boolean(chunkState?.chunk?.isLoad),
        tempLoadedCount: chunkState?.tempLoadedCount ?? 0,
        fullLoadedCount: chunkState?.fullLoadedCount ?? 0,
        chunk: this.cloneSnapshot(chunkState?.chunk),
      }),
    );

    console.log("[debugger-tool] loaded chunks:", loadedChunks);
  }

  logObjectLoad(board) {
    const loadedObjects = Array.from(board.objectLoaded.entries()).map(
      ([objectId, objectState]) => ({
        objectId,
        loadedCount: objectState?.loadedCount ?? 0,
        object: this.cloneSnapshot(objectState?.obj),
      }),
    );

    console.log("[debugger-tool] loaded objects:", loadedObjects);
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

    console.log(`[debugger-tool] chunk ${chunkId}:`, this.cloneSnapshot(chunk));
  }

  logActiveObjectManager(board) {
    const aom = board.activeObjectManager ?? {};
    const activeObjects = Array.from(aom.activeObjects ?? []).map((obj) => obj.id);
    const activeObjectIndexIds = Array.from(aom.activeObjectIndex?.keys?.() ?? []);
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
    console.log("[debugger-tool] board:", this.cloneSnapshot(board));
  }
}

export { DebuggerTool };
