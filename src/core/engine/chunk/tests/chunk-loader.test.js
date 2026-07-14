import { jest } from "@jest/globals";
import { ChunkLoader, CHUNK_LOAD_EVENTS } from "../chunk-loader.js";
import { Chunk } from "../chunk.js";
import { EventBus } from "../../utils/event-bus.js";

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

  test("destroy 不带 delay 应立即销毁", () => {
    const bus = new EventBus();
    const chunk = Chunk.fromCoordinate(0, 0);
    const loader = new ChunkLoader({ eventBus: bus, requesterId: "t" });
    const unloadHandler = jest.fn();
    bus.on(CHUNK_LOAD_EVENTS.REQUEST_UNLOAD, unloadHandler);

    loader.trackChunk(chunk);
    loader.destroy();

    expect(unloadHandler).toHaveBeenCalledTimes(1);
    expect(loader.chunksLoaded.size).toBe(0);
  });

  test("destroy 带 delayMs 应在定时后才销毁", async () => {
    jest.useFakeTimers();

    const bus = new EventBus();
    const chunk = Chunk.fromCoordinate(0, 0);
    const loader = new ChunkLoader({ eventBus: bus, requesterId: "t" });
    const unloadHandler = jest.fn();
    bus.on(CHUNK_LOAD_EVENTS.REQUEST_UNLOAD, unloadHandler);

    loader.trackChunk(chunk);
    loader.destroy(200);

    // 定时器到期前不应卸载
    expect(unloadHandler).not.toHaveBeenCalled();
    expect(loader.chunksLoaded.has(chunk.id)).toBe(true);

    // 快进定时器
    jest.advanceTimersByTime(200);

    expect(unloadHandler).toHaveBeenCalledTimes(1);
    expect(loader.chunksLoaded.size).toBe(0);

    jest.useRealTimers();
  });

  test("cancelScheduledDestroy 应取消挂起的销毁", () => {
    jest.useFakeTimers();

    const loader = new ChunkLoader();
    loader.getChunkById(1);
    loader.destroy(200);

    expect(loader.cancelScheduledDestroy()).toBe(true);
    // 快进定时器后 loader 仍应存活
    jest.advanceTimersByTime(200);
    expect(loader.chunksLoaded.size).toBe(1);

    jest.useRealTimers();
  });

  test("cancelScheduledDestroy 无挂起销毁时返回 false", () => {
    const loader = new ChunkLoader();
    expect(loader.cancelScheduledDestroy()).toBe(false);
  });

  test("延迟销毁期间调 trackChunk 应自动取消定时的销毁", () => {
    jest.useFakeTimers();

    const loader = new ChunkLoader();
    loader.getChunkById(1);
    loader.destroy(200);
    loader.trackChunk(Chunk.fromCoordinate(2, 0));

    jest.advanceTimersByTime(200);
    // 定时被取消，loader 应仍然持有区块
    expect(loader.chunksLoaded.has(1)).toBe(true);
    expect(loader.chunksLoaded.has(Chunk.coordinateToId(2, 0))).toBe(true);

    jest.useRealTimers();
  });

  test("延迟销毁期间调 getChunkById 应自动取消定时的销毁", () => {
    jest.useFakeTimers();

    const loader = new ChunkLoader();
    loader.getChunkById(1);
    loader.destroy(200);
    // 访问已持有区块，取消定时
    loader.getChunkById(1);

    jest.advanceTimersByTime(200);
    expect(loader.chunksLoaded.has(1)).toBe(true);

    jest.useRealTimers();
  });

  test("destroy 再次调用（无 delay）应立即销毁并清除挂起的定时", () => {
    jest.useFakeTimers();

    const loader = new ChunkLoader();
    loader.getChunkById(1);
    loader.destroy(200);
    // 在定时到期前再次调用 destroy（无 delay）
    loader.destroy();

    // 区块应立即被清除
    expect(loader.chunksLoaded.size).toBe(0);

    jest.useRealTimers();
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
