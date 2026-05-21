import { Board } from "../board.js";
import { Chunk } from "../chunk.js";
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

  test("ChunkLoader 应按区域初始化缓冲范围", () => {
    const board = new Board();
    const chunkLoader = board.createChunkLoader();

    const neighborhood = chunkLoader.initChunksAroundCoordinate(0, 0);
    const currentChunk = chunkLoader.chunkNow;

    expect(currentChunk).toEqual(expect.objectContaining({ id: 1, x: 0, y: 0 }));
    expect(
      neighborhood.map((chunk) => chunk.id).sort((left, right) => left - right),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(chunkLoader.chunksLoadedCount).toBe(9);
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
