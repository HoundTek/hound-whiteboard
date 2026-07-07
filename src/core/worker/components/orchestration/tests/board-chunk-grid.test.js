import { jest } from "@jest/globals";
import { BoardCore } from "../board-core.js";
import { Chunk } from "../../chunk/chunk.js";
import {
  CHUNK_LOAD_EVENTS,
  CHUNK_LOAD_STRATEGIES,
} from "../../chunk/chunk-loader.js";
import { StrokeObject } from "../../../../shared/objects/stroke/stroke.js";
import { Vector } from "../../../../utils/math.js";
import { ChunkObjectManager } from "../../chunk/chunk-object-manager.js";
import { boardFileOperateBridge } from "../../../../bridges/file-operate-bridge-renderer.js";
import { createDefaultAomRenderHooks } from "../aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../../../bridges/persistence-adapter.js";

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
    expect(Chunk.isValidChunkIdentity(3, 1, 1)).toBe(true);
    expect(Chunk.isValidChunkIdentity(3, 0, 0)).toBe(false);
  });

  test("Chunk 应能从已加载的 neighbor 访问上下左右关联", () => {
    const center = Chunk.fromId(1);
    const right = Chunk.fromId(2);
    const left = Chunk.fromId(5);
    const up = Chunk.fromId(3);
    const down = Chunk.fromId(9);

    Chunk.connectTwoChunk(center, right, "right");
    Chunk.connectTwoChunk(center, left, "left");
    Chunk.connectTwoChunk(center, up, "up");
    Chunk.connectTwoChunk(center, down, "down");

    expect(right.leftChunk).toBe(center);
    expect(left.rightChunk).toBe(center);
    expect(up.downChunk).toBe(center);
    expect(down.upChunk).toBe(center);
  });

  test("BoardCore 应能通过 getChunkById 查找已加载区块", async () => {
    const boardCore = new BoardCore({
      width: 800,
      height: 600,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });

    // chunkLoaded initially empty before any access
    expect(boardCore.chunkLoaded.size).toBe(0);

    // getChunkById auto-creates chunk via ChunkLoader
    const chunk = boardCore.getChunkById(1);
    expect(chunk).toBeDefined();
    expect(chunk.id).toBe(1);
    expect(boardCore.chunkLoaded.has(1)).toBe(true);
  });
});
