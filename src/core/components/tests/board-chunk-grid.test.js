import { jest } from "@jest/globals";
import { Board } from "../board.js";
import { Chunk } from "../chunk.js";
import { CHUNK_LOAD_EVENTS } from "../chunk-loader.js";
import { StrokeObject } from "../../objects/stroke/stroke.js";
import { Vector } from "../../utils/math.js";

describe("Board chunk grid", () => {
  test("Chunk 的回字形 id 与二维坐标应可双向转换", () => {
    const samples = [
      [1, 0, 0],
      [2, 1, 0],
      [3, 1, 1],
      [5, -1, 1],
      [9, 1, -1],
      [10, 2, -1],
      [13, 2, 2],
      [17, -2, 2],
    ];

    for (const [id, x, y] of samples) {
      expect(Chunk.idToCoordinate(id)).toEqual({ x, y });
      expect(Chunk.coordinateToId(x, y)).toBe(id);
    }
  });

  test("Chunk 应能判断 id 与坐标是否匹配", () => {
    const validChunk = Chunk.fromId(3);
    const invalidChunk = Chunk.fromId(3);
    invalidChunk.id = -1; // 强制设置非法 id

    expect(Chunk.isValidChunkIdentity(3, 1, 1)).toBe(true);
    expect(Chunk.isValidChunkIdentity(3, 2, 0)).toBe(false);
    expect(validChunk.isValid()).toBe(true);
    expect(invalidChunk.isValid()).toBe(false);
  });

  test("ChunkBlockLoader 应按区域初始化缓冲范围", () => {
    const board = new Board();
    const chunkBlockLoader = board.createChunkBlockLoader();

    const neighborhood = chunkBlockLoader.initChunksAroundCoordinate(0, 0);
    const currentChunk = chunkBlockLoader.chunkNow;

    expect(currentChunk).toEqual(expect.objectContaining({ id: 1, x: 0, y: 0 }));
    expect(
      neighborhood.map((chunk) => chunk.id).sort((left, right) => left - right),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(chunkBlockLoader.chunksLoadedCount).toBe(9);
  });

  test("Board 的左右邻区块应基于二维坐标解析", () => {
    const board = new Board();

    const center = board.getChunkById(1);

    expect(board.getNeighborChunk(center, "right")).toEqual(
      expect.objectContaining({ id: 2, x: 1, y: 0 }),
    );
    expect(board.getNeighborChunk(center, "left")).toEqual(
      expect.objectContaining({ id: 6, x: -1, y: 0 }),
    );
    expect(board.getNeighborChunk(center, "up")).toEqual(
      expect.objectContaining({ id: 4, x: 0, y: 1 }),
    );
    expect(board.getNeighborChunk(center, "down")).toEqual(
      expect.objectContaining({ id: 8, x: 0, y: -1 }),
    );
  });

  test("Board 应通过根 ChunkLoader 暴露区块访问与卸载能力", () => {
    const board = new Board();
    const chunkLoader = board.getChunkLoader();

    const center = board.getChunkById(1);
    const right = board.getChunkByCoordinate(1, 0);

    expect(chunkLoader.getChunkById(1)).toBe(center);
    expect(chunkLoader.getChunkByCoordinate(1, 0)).toBe(right);
    expect(chunkLoader.unloadChunkById(2)).toBe(true);
    expect(board.chunkLoaded.has(2)).toBe(false);

    chunkLoader.getChunkByCoordinate(0, 1);
    expect(chunkLoader.clear()).toBe(true);
    expect(board.chunkLoaded.size).toBe(0);
  });

  test("Board 应响应根 ChunkLoader 直接发出的完整加载请求", async () => {
    const board = new Board();
    const chunkLoader = board.getChunkLoader();
    const chunk = chunkLoader.getChunkByCoordinate(0, 0);
    const loadFullSpy = jest
      .spyOn(chunk, "loadFull")
      .mockImplementation(async () => {
        chunk.isLoad = true;
        chunk.isTempLoad = false;
        return true;
      });

    const results = board.chunkLoadEventBus.emit(CHUNK_LOAD_EVENTS.REQUEST_LOAD, {
      requesterId: "board-root",
      chunk,
      strategy: "full",
      direction: "right",
      source: "test",
      alreadyBuffered: false,
    });

    expect(results).toHaveLength(1);
    await results[0];
    expect(loadFullSpy).toHaveBeenCalledWith(board.rootPath);
    expect(board.chunkLoaded.get(chunk.id)?.fullLoadedCount).toBe(1);
    expect(board.chunkLoaded.get(chunk.id)?.loaderStrategy.get("board-root")).toBe(
      "full",
    );
  });

  test("Board 应响应根 ChunkLoader 直接发出的卸载请求", async () => {
    const board = new Board();
    const chunkLoader = board.getChunkLoader();
    const chunk = chunkLoader.getChunkByCoordinate(0, 0);
    chunk.isLoad = true;
    chunk.isTempLoad = false;
    board.chunkLoaded.set(chunk.id, {
      chunk,
      tempLoadedCount: 0,
      fullLoadedCount: 1,
      loaderStrategy: new Map([["board-root", "full"]]),
    });
    const unloadSpy = jest.spyOn(chunk, "unload").mockReturnValue(true);

    const results = board.chunkLoadEventBus.emit(
      CHUNK_LOAD_EVENTS.REQUEST_UNLOAD,
      {
        requesterId: "board-root",
        chunk,
        source: "test",
      },
    );

    expect(results).toHaveLength(1);
    await results[0];
    expect(unloadSpy).toHaveBeenCalledTimes(1);
    expect(board.chunkLoaded.get(chunk.id)?.fullLoadedCount ?? 0).toBe(0);
    expect(board.chunkLoaded.get(chunk.id)?.loaderStrategy.has("board-root")).toBe(
      false,
    );
  });

  test("Board.addObject 应将对象加入归属区块并同步覆盖区块索引", () => {
    const board = new Board();
    board.width = 10;
    board.height = 10;

    const stroke = new StrokeObject(new Vector(0, 0), 15, 1);
    stroke.setPathPoints([
      new Vector(1, 1),
      new Vector(19, 1),
      new Vector(19, 19),
    ]);

    board.addObject(stroke);

    const ownerChunk = board.getChunkById(1);
    expect(ownerChunk.objectManager.chunkObjects.get(15)).toBe(stroke);
    expect(ownerChunk.objectManager.staticGraph.hasNode(15)).toBe(true);
    expect(ownerChunk.objectManager.getObjectCoverChunks(15)).toEqual(
      new Set([1, 2, 3]),
    );
  });
});
