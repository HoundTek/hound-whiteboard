import { jest } from "@jest/globals";
import { ChunkBlockLoader, CHUNK_LOAD_MANAGER_EVENTS } from "../chunk-block-loader.js";
import { Chunk } from "../chunk.js";
import { EventBus } from "../../utils/event-bus.js";

describe("ChunkBlockLoader", () => {
  function createChunks() {
    const chunk1 = Chunk.fromCoordinate(0, 0);
    const chunk2 = Chunk.fromCoordinate(1, 0);
    const chunk3 = Chunk.fromCoordinate(2, 0);

    Chunk.connectTwoChunk(chunk1, chunk2);
    Chunk.connectTwoChunk(chunk2, chunk3);

    return { chunk1, chunk2, chunk3 };
  }

  test("forceMoveCurrentRightTempLoad 应该请求加载并移动当前区块", () => {
    const bus = new EventBus();
    const loader = new ChunkBlockLoader(3, bus);
    const { chunk1, chunk2 } = createChunks();
    const loadHandler = jest.fn();

    bus.on(CHUNK_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.initChunk(chunk1);
    const changed = loader.forceMoveCurrentRightTempLoad();

    expect(changed).toBe(true);
    expect(loader.chunkNow).toBe(chunk2);
    expect(loader.getLoadedChunks()).toEqual([chunk1, chunk2]);
    expect(loader.chunksLoaded.has(chunk1.id)).toBe(true);
    expect(loader.chunksLoaded.has(chunk2.id)).toBe(true);
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        chunk: chunk2,
        strategy: "temp",
        source: "force-move",
        alreadyBuffered: false,
      }),
    );
  });

  test("expandBufferRightFullLoad 应该在不移动当前区块的情况下扩展缓冲区", () => {
    const bus = new EventBus();
    const loader = new ChunkBlockLoader(3, bus);
    const { chunk1, chunk2 } = createChunks();
    const loadHandler = jest.fn();

    bus.on(CHUNK_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.initChunk(chunk1);
    const expanded = loader.expandBufferRightFullLoad();

    expect(expanded).toBe(true);
    expect(loader.chunkNow).toBe(chunk1);
    expect(loader.getLoadedChunks()).toEqual([chunk1, chunk2]);
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        chunk: chunk2,
        strategy: "full",
        source: "expand-buffer",
      }),
    );
  });

  test("缓冲区超限时应淘汰反方向区块并发出卸载请求", () => {
    const bus = new EventBus();
    const loader = new ChunkBlockLoader(2, bus);
    const { chunk1, chunk2, chunk3 } = createChunks();
    const unloadHandler = jest.fn();

    bus.on(CHUNK_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD, unloadHandler);

    loader.initChunk(chunk2);
    loader.expandBufferRightTempLoad();
    loader.forceMoveCurrentLeftFullLoad();

    expect(loader.chunkNow).toBe(chunk1);
    expect(loader.getLoadedChunks()).toEqual([chunk1, chunk2]);
    expect(unloadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        chunk: chunk3,
        source: "buffer-limit",
      }),
    );
  });

  test("shrinkBufferRight 应该移除右边界，但不能移除当前区块", () => {
    const bus = new EventBus();
    const loader = new ChunkBlockLoader(3, bus);
    const { chunk1, chunk2, chunk3 } = createChunks();
    const unloadHandler = jest.fn();

    bus.on(CHUNK_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD, unloadHandler);

    loader.initChunk(chunk1);
    loader.expandBufferRightTempLoad();
    loader.expandBufferRightTempLoad();

    const shrunk = loader.shrinkBufferRight();

    expect(shrunk).toBe(true);
    expect(loader.chunkNow).toBe(chunk1);
    expect(loader.getLoadedChunks()).toEqual([chunk1, chunk2]);
    expect(unloadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        chunk: chunk3,
        source: "shrink-buffer",
      }),
    );
  });

  test("shrinkBufferLeft 在当前区块位于左边界时不应收缩", () => {
    const bus = new EventBus();
    const loader = new ChunkBlockLoader(3, bus);
    const { chunk1, chunk2 } = createChunks();
    const unloadHandler = jest.fn();

    bus.on(CHUNK_LOAD_MANAGER_EVENTS.REQUEST_UNLOAD, unloadHandler);

    loader.initChunk(chunk1);
    loader.expandBufferRightTempLoad();

    const shrunk = loader.shrinkBufferLeft();

    expect(shrunk).toBe(false);
    expect(loader.getLoadedChunks()).toEqual([chunk1, chunk2]);
    expect(unloadHandler).not.toHaveBeenCalled();
  });

  test("forceMoveCurrentUpTempLoad 应该支持二维邻区块导航", () => {
    const bus = new EventBus();
    const chunk1 = Chunk.fromId(1);
    const chunkUp = Chunk.fromId(4);
    const loadHandler = jest.fn();
    const loader = new ChunkBlockLoader(3, bus, undefined, (chunk, direction) => {
      if (chunk === chunk1 && direction === "up") return chunkUp;
      if (chunk === chunkUp && direction === "down") return chunk1;
      return undefined;
    });

    bus.on(CHUNK_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.initChunk(chunk1);
    const changed = loader.forceMoveCurrentUpTempLoad();

    expect(changed).toBe(true);
    expect(loader.chunkNow).toBe(chunkUp);
    expect(loader.getLoadedChunks()).toEqual([chunkUp, chunk1]);
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        chunk: chunkUp,
        strategy: "temp",
        source: "force-move",
        alreadyBuffered: false,
      }),
    );
  });

  test("二维缓冲区向右扩展时应加载整条右边界", () => {
    const bus = new EventBus();
    const chunk1 = Chunk.fromCoordinate(0, 0);
    const chunkUp = Chunk.fromCoordinate(0, 1);
    const chunkRight = Chunk.fromCoordinate(1, 0);
    const chunkUpRight = Chunk.fromCoordinate(1, 1);
    const loadHandler = jest.fn();
    const chunks = new Map([
      ["0,0", chunk1],
      ["0,1", chunkUp],
      ["1,0", chunkRight],
      ["1,1", chunkUpRight],
    ]);
    const loader = new ChunkBlockLoader(0, bus, undefined, (chunk, direction) => {
      const delta = {
        right: [1, 0],
        left: [-1, 0],
        up: [0, 1],
        down: [0, -1],
      }[direction];
      if (!delta) return undefined;
      return chunks.get(`${chunk.x + delta[0]},${chunk.y + delta[1]}`);
    });

    bus.on(CHUNK_LOAD_MANAGER_EVENTS.REQUEST_LOAD, loadHandler);

    loader.initChunk(chunk1);
    loader.expandBufferUpTempLoad();
    const expanded = loader.expandBufferRightTempLoad();

    expect(expanded).toBe(true);
    expect(loader.getLoadedChunks()).toEqual([
      chunkUp,
      chunkUpRight,
      chunk1,
      chunkRight,
    ]);
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({ chunk: chunkRight, direction: "right" }),
    );
    expect(loadHandler).toHaveBeenCalledWith(
      expect.objectContaining({ chunk: chunkUpRight, direction: "right" }),
    );
  });

  test("initChunksAroundCoordinate 应清空旧缓冲区并按区域重建", () => {
    const bus = new EventBus();
    const loader = new ChunkBlockLoader(0, bus);

    loader.initChunk(Chunk.fromCoordinate(5, 5));
    const chunks = loader.initChunksAroundCoordinate(0, 0, 1);

    expect(loader.chunkNow).toEqual(expect.objectContaining({ id: 1, x: 0, y: 0 }));
    expect(loader.chunksLoadedCount).toBe(9);
    expect(
      chunks.map((chunk) => chunk.id).sort((left, right) => left - right),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
