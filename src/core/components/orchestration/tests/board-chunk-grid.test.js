import { jest } from "@jest/globals";
import { Board } from "../board.js";
import { Chunk } from "../../chunk/chunk.js";
import { CHUNK_LOAD_EVENTS } from "../../chunk/chunk-loader.js";
import { StrokeObject } from "../../../objects/stroke/stroke.js";
import { Vector } from "../../../utils/math.js";
import { ChunkObjectManager } from "../../chunk/chunk-object-manager.js";
import { boardFileOperateBridge } from "../../../bridges/file-operate-bridge-renderer.js";

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
    const board = new Board({
      rootPath: "/tmp/hwb-board-test",
    });
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

  test("memory board 的根 ChunkLoader 不应真正卸载区块", () => {
    const board = new Board({});
    const chunkLoader = board.getChunkLoader();
    const chunk = chunkLoader.getChunkByCoordinate(0, 0);
    chunk.isLoad = true;
    chunk.isTempLoad = false;

    const unloadSpy = jest.spyOn(chunk, "unload").mockReturnValue(true);

    expect(chunkLoader.unloadChunkById(chunk.id)).toBe(false);
    expect(unloadSpy).not.toHaveBeenCalled();
    expect(board.chunkLoaded.has(chunk.id)).toBe(true);
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

    const results = board.chunkLoadEventBus.emit(
      CHUNK_LOAD_EVENTS.REQUEST_LOAD,
      {
        requesterId: "board-root",
        chunk,
        strategy: "full",
        direction: "right",
        source: "test",
        alreadyBuffered: false,
      },
    );

    expect(results).toHaveLength(1);
    await results[0];
    expect(loadFullSpy).toHaveBeenCalledWith(board.rootPath);
    expect(board.chunkLoaded.get(chunk.id)?.fullLoadedCount).toBe(1);
    expect(
      board.chunkLoaded.get(chunk.id)?.loaderStrategy.get("board-root"),
    ).toBe("full");
  });

  test("无 rootPath 时完整加载请求不应访问文件桥", async () => {
    const board = new Board();
    const chunkLoader = board.getChunkLoader();
    const chunk = chunkLoader.getChunkByCoordinate(0, 0);
    const loadMetadataSpy = jest.spyOn(
      boardFileOperateBridge,
      "loadChunkMetadata",
    );

    const results = board.chunkLoadEventBus.emit(
      CHUNK_LOAD_EVENTS.REQUEST_LOAD,
      {
        requesterId: "demo-monitor",
        chunk,
        strategy: "full",
        direction: "right",
        source: "test",
        alreadyBuffered: false,
      },
    );

    expect(results).toHaveLength(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(loadMetadataSpy).not.toHaveBeenCalled();
    expect(chunk.isLoad).toBe(true);
    expect(chunk.isTempLoad).toBe(false);
    expect(board.chunkLoaded.get(chunk.id)?.fullLoadedCount).toBe(1);

    loadMetadataSpy.mockRestore();
  });

  test("存在 rootPath 时应启用文件系统持久化", async () => {
    const board = new Board({
      rootPath: "/tmp/hwb-demo-memory",
    });
    const chunkLoader = board.getChunkLoader();
    const chunk = chunkLoader.getChunkByCoordinate(0, 0);
    const loadMetadataSpy = jest
      .spyOn(boardFileOperateBridge, "loadChunkMetadata")
      .mockResolvedValue({ tierGraph: [], objectCoverIndex: [] });

    const results = board.chunkLoadEventBus.emit(
      CHUNK_LOAD_EVENTS.REQUEST_LOAD,
      {
        requesterId: "demo-monitor",
        chunk,
        strategy: "full",
        direction: "right",
        source: "test",
        alreadyBuffered: false,
      },
    );

    expect(board.isPersistent()).toBe(true);
    expect(results).toHaveLength(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(loadMetadataSpy).toHaveBeenCalledWith(board.rootPath, 1);
    expect(chunk.isLoad).toBe(true);
    expect(chunk.isTempLoad).toBe(false);
    expect(board.chunkLoaded.get(chunk.id)?.fullLoadedCount).toBe(1);

    loadMetadataSpy.mockRestore();
  });

  test("Board 应响应根 ChunkLoader 直接发出的卸载请求", async () => {
    const board = new Board({ rootPath: "/tmp/hwb-board-test" });
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
    expect(
      board.chunkLoaded.get(chunk.id)?.loaderStrategy.has("board-root"),
    ).toBe(false);
  });

  test("memory board 应忽略区块卸载请求", async () => {
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
    await new Promise((resolve) => setImmediate(resolve));
    expect(unloadSpy).not.toHaveBeenCalled();
    expect(board.chunkLoaded.get(chunk.id)?.fullLoadedCount).toBe(1);
    expect(
      board.chunkLoaded.get(chunk.id)?.loaderStrategy.has("board-root"),
    ).toBe(true);
  });

  test("Board.addObject 应将对象加入归属区块并同步覆盖区块索引", () => {
    const board = new Board();
    board.width = 10;
    board.height = 10;

    const stroke = new StrokeObject(15, new Vector(0, 0));
    stroke.setPathPoints([
      new Vector(1, 1),
      new Vector(19, 1),
      new Vector(19, 19),
    ]);

    board.addObject(stroke);

    const ownerChunk = board.getChunkById(1);
    expect(ownerChunk.objectManager.getObject(15)).toBe(stroke);
    expect(ownerChunk.objectManager.staticGraph.hasNode(15)).toBe(true);
    expect(ownerChunk.objectManager.getObjectCoverChunks(15)).toEqual(
      new Set([1, 2, 3]),
    );
  });

  test("Board.loadChunkObjectEntries 应通过桥接加载对象并写入 Board 注册表", async () => {
    const stroke = new StrokeObject(201, new Vector(10, 20));
    stroke.setPathPoints([new Vector(0, 0), new Vector(5, 5)]);

    // spy 必须先于 Board 构造（因 persistence adapter 在构造时捕获桥引用）
    const loadObjectsSpy = jest
      .spyOn(boardFileOperateBridge, "loadObjects")
      .mockResolvedValue([stroke.serialize()]);

    const board = new Board({
      rootPath: "/tmp/hwb-board-test",
    });

    const ownerChunk = board.getChunkById(1);
    ownerChunk.objectManager = new ChunkObjectManager(ownerChunk.id, board);
    ownerChunk.objectManager.staticGraph.addNodeUnsafe(201);
    ownerChunk.objectManager.setObjectCoverChunks(201, [1]);

    board.chunkLoaded.set(1, {
      chunk: ownerChunk,
      tempLoadedCount: 0,
      fullLoadedCount: 1,
      loaderStrategy: new Map([["test-monitor", "full"]]),
    });

    const loadedEntries = await board.loadChunkObjectEntries(ownerChunk);

    expect(loadObjectsSpy).toHaveBeenCalledWith("/tmp/hwb-board-test", [201]);
    expect(loadedEntries.get(201)).toBeInstanceOf(StrokeObject);
    expect(board.getObjectById(201)).toBeInstanceOf(StrokeObject);
    expect(ownerChunk.objectManager.getObject(201)).toBe(
      board.getObjectById(201),
    );
    expect(board.getObjectLoadCount(201)).toBe(1);

    loadObjectsSpy.mockRestore();
  });

  test("Board.saveChunkObjectEntries 应按层叠图节点保存对象", async () => {
    const ownerObject = new StrokeObject(301, new Vector(10, 20));
    ownerObject.setPathPoints([new Vector(0, 0), new Vector(5, 5)]);

    // spy 必须先于 Board 构造
    const saveObjectsSpy = jest
      .spyOn(boardFileOperateBridge, "saveObjects")
      .mockResolvedValue(true);

    const board = new Board({
      rootPath: "/tmp/hwb-board-test",
    });

    const chunk = board.getChunkById(1);
    chunk.objectManager = new ChunkObjectManager(chunk.id, board);
    chunk.objectManager.staticGraph.addNodeUnsafe(301);

    board.registerObjectInstance(ownerObject, { coveredChunkIds: [1] });

    await board.saveChunkObjectEntries(1);

    expect(saveObjectsSpy).toHaveBeenCalledWith("/tmp/hwb-board-test", [
      ownerObject.serialize(),
    ]);

    saveObjectsSpy.mockRestore();
  });
});
