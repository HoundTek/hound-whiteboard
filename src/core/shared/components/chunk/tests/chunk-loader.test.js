import { jest } from "@jest/globals";
import { ChunkLoader, CHUNK_LOAD_EVENTS } from "../chunk-loader.js";
import { Chunk } from "../chunk.js";
import { EventBus } from "../../../../utils/event-bus.js";

describe("ChunkLoader", () => {
  test("应按 id 和坐标复用同一个区块实例", () => {
    const loader = new ChunkLoader();

    const chunkById = loader.getChunkById(1);
    const chunkByCoordinate = loader.getChunkByCoordinate(0, 0);

    expect(chunkByCoordinate).toBe(chunkById);
    expect(loader.chunksLoadedCount).toBe(1);
  });

  test("应在已管理区块之间同步四向邻接引用", () => {
    const loader = new ChunkLoader();

    const center = loader.getChunkByCoordinate(0, 0);
    const right = loader.getChunkByCoordinate(1, 0);
    const up = loader.getChunkByCoordinate(0, 1);

    expect(center.rightChunk).toBe(right);
    expect(right.leftChunk).toBe(center);
    expect(center.upChunk).toBe(up);
    expect(up.downChunk).toBe(center);
  });

  test("应支持按 id、坐标卸载和 clear", () => {
    const unloadHandler = jest.fn(() => true);
    const loader = new ChunkLoader({ unloadChunk: unloadHandler });

    loader.getChunkByCoordinate(0, 0);
    loader.getChunkByCoordinate(1, 0);

    expect(loader.unloadChunkByCoordinate(1, 0)).toBe(true);
    expect(loader.chunksLoadedCount).toBe(1);
    expect(loader.unloadChunkById(1)).toBe(true);
    expect(loader.chunksLoadedCount).toBe(0);

    loader.getChunkByCoordinate(0, 0);
    loader.getChunkByCoordinate(0, 1);
    expect(loader.clear()).toBe(true);
    expect(loader.chunksLoadedCount).toBe(0);
    expect(unloadHandler).toHaveBeenCalledTimes(4);
  });

  test("应由 ChunkLoader 直接发出加载、卸载与缓冲区更新事件", () => {
    const bus = new EventBus();
    const chunk = Chunk.fromCoordinate(0, 0);
    const loader = new ChunkLoader({ eventBus: bus, requesterId: "loader-1" });
    const loadHandler = jest.fn();
    const unloadHandler = jest.fn();
    const updateHandler = jest.fn();

    bus.on(CHUNK_LOAD_EVENTS.REQUEST_LOAD, loadHandler);
    bus.on(CHUNK_LOAD_EVENTS.REQUEST_UNLOAD, unloadHandler);
    bus.on(CHUNK_LOAD_EVENTS.BUFFER_UPDATED, updateHandler);

    expect(
      loader.emitLoadRequest(chunk, {
        strategy: "temp",
        direction: "right",
        source: "test",
      }),
    ).toBe(true);
    expect(loader.emitUnloadRequest(chunk, { source: "test" })).toBe(true);
    expect(
      loader.emitBufferUpdated({
        action: "reset",
        direction: "none",
        chunkNow: chunk,
        chunksLoaded: [chunk],
        bufferBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      }),
    ).toBe(true);

    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterId: "loader-1",
        chunk,
        strategy: "temp",
        direction: "right",
        source: "test",
        alreadyBuffered: false,
      }),
    );
    expect(unloadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterId: "loader-1",
        chunk,
        source: "test",
      }),
    );
    expect(updateHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reset",
        direction: "none",
        chunkNow: chunk,
      }),
    );
  });
});