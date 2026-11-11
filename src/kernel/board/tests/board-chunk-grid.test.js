// SPDX-License-Identifier: MIT

import { jest } from "@jest/globals";
import { BoardCore } from "../board-core.js";
import { Chunk } from "../../chunk/chunk.js";
import {
  CHUNK_LOAD_EVENTS,
  CHUNK_LOAD_STRATEGIES,
} from "../../chunk/chunk-loader.js";
import { StrokeObject } from "../../objects/stroke/stroke.js";
import { Vector } from "../../utils/math.js";
import { ChunkObjectManager } from "../../chunk/chunk-object-manager.js";
import { createDefaultAomRenderHooks } from "../aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../persistence-adapter.js";

describe("区块边长配置", () => {
  test("不传时使用默认 1024，非法值同样回退", () => {
    for (const options of [{}, { width: 0, height: 0 }, { width: -1, height: Number.NaN }]) {
      const boardCore = new BoardCore({
        ...options,
        aomRenderHooks: createDefaultAomRenderHooks(),
        persistenceAdapter: createDefaultPersistenceAdapter(),
      });
      expect({ w: boardCore.width, h: boardCore.height }).toEqual({
        w: 1024,
        h: 1024,
      });
    }
  });

  test("长宽可独立设置，对象归属按各自边长计算", () => {
    const boardCore = new BoardCore({
      width: 512,
      height: 256,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });

    // 512×256 的网格里 (600, 300) 落在 (1, 1) 格 = id 3
    const chunkId = Chunk.worldToChunkId({ x: 600, y: 300 }, 512, 256);
    expect(chunkId).toBe(3);
    expect(Chunk.idToCoordinate(3)).toEqual({ x: 1, y: 1 });
    void boardCore;
  });

  test("会话元数据持久化区块边长", () => {
    const boardCore = new BoardCore({
      width: 512,
      height: 768,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
    expect(boardCore.collectSessionMeta().boardConfig).toEqual({
      width: 512,
      height: 768,
    });
  });
});

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
