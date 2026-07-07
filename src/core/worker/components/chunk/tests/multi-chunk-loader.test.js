/**
 * @file 多 ChunkLoader 协作测试
 * @description 验证多个 ChunkLoader 通过 Board 事件总线并发加载/卸载同一区块时的引用计数与生命周期管理。
 * @module core/worker/components/chunk/tests/multi-chunk-loader
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import os from "os";
import path from "path";

import { BoardCore } from "../../../components/orchestration/board-core.js";
import { Chunk } from "../chunk.js";
import { CHUNK_LOAD_EVENTS, CHUNK_LOAD_STRATEGIES } from "../chunk-loader.js";
import { createDefaultAomRenderHooks } from "../../../components/orchestration/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../../../bridges/persistence-adapter.js";

describe("Multiple ChunkLoader", () => {
  let boardCore;

  beforeEach(() => {
    boardCore = new BoardCore({
      width: 800,
      height: 600,
      aomRenderHooks: createDefaultAomRenderHooks(),
      persistenceAdapter: createDefaultPersistenceAdapter(),
    });
  });

  function getChunkLoadState(_board, chunkId) {
    return boardCore.chunkLoaded.get(chunkId);
  }

  function createBoardHarness() {
    const board = {};
    const chunk1 = Chunk.fromId(6);
    const chunk2 = Chunk.fromId(1);
    const chunk3 = Chunk.fromId(2);

    for (const chunk of [chunk1, chunk2, chunk3]) {
      chunk.board = board;
      chunk.loadFull = jest.fn(function loadFull() {
        this.isLoad = true;
        this.isTempLoad = false;
        return true;
      });
      chunk.loadTemp = jest.fn(function loadTemp() {
        this.isLoad = true;
        this.isTempLoad = true;
        return true;
      });
      chunk.unload = jest.fn(function unload() {
        this.isLoad = false;
        this.isTempLoad = false;
        return true;
      });
      chunk.unloadTemp = jest.fn(function unloadTemp() {
        this.isLoad = false;
        this.isTempLoad = false;
        return true;
      });
      chunk.downgradeToTemp = jest.fn(function downgradeToTemp() {
        this.isLoad = true;
        this.isTempLoad = true;
        return true;
      });
    }

    boardCore.rootPath = path.join(os.tmpdir(), "houndwhiteboard-board-test");
    for (const chunk of [chunk1, chunk2, chunk3]) {
      boardCore.chunkLoaded.set(chunk.id, {
        chunk,
        tempLoadedCount: 0,
        fullLoadedCount: 0,
        loaderStrategy: new Map(),
      });
    }

    return { board, chunk1, chunk2, chunk3 };
  }

  /**
   * 通过 ChunkLoader 发出加载请求并等待 Board 处理
   */
  async function requestTempLoad(board, chunk) {
    const loader = boardCore.createChunkLoader(
      `test-${Date.now()}-${Math.random()}`,
    );
    loader.getChunkById(chunk.id);
    const results = boardCore.chunkLoadEventBus.emit(
      CHUNK_LOAD_EVENTS.REQUEST_LOAD,
      {
        requesterId: loader.requesterId,
        chunk,
        strategy: "temp",
        direction: "none",
        source: "test",
        alreadyBuffered: false,
      },
    );
    expect(results).toHaveLength(1);
    await results[0];
    return loader;
  }

  /**
   * 通过 ChunkLoader 发出完整加载请求并等待 Board 处理
   */
  async function requestFullLoad(board, chunk) {
    const loader = boardCore.createChunkLoader(
      `test-${Date.now()}-${Math.random()}`,
    );
    loader.getChunkById(chunk.id);
    const results = boardCore.chunkLoadEventBus.emit(
      CHUNK_LOAD_EVENTS.REQUEST_LOAD,
      {
        requesterId: loader.requesterId,
        chunk,
        strategy: "full",
        direction: "none",
        source: "test",
        alreadyBuffered: false,
      },
    );
    expect(results).toHaveLength(1);
    await results[0];
    return loader;
  }

  /**
   * 通过 ChunkLoader 发出卸载请求并等待 Board 处理
   */
  async function requestUnload(board, chunk, requesterId) {
    const results = boardCore.chunkLoadEventBus.emit(
      CHUNK_LOAD_EVENTS.REQUEST_UNLOAD,
      {
        requesterId,
        chunk,
        source: "test",
      },
    );
    expect(results).toHaveLength(1);
    await results[0];
  }

  test("ChunkLoader 的临时加载请求应由 Board 执行", async () => {
    const { board, chunk2 } = createBoardHarness();

    await requestTempLoad(board, chunk2);

    expect(chunk2.loadTemp).toHaveBeenCalledTimes(1);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(1);
  });

  test("ChunkLoader 的完整加载请求应由 Board 执行", async () => {
    const { board, chunk2 } = createBoardHarness();

    await requestFullLoad(board, chunk2);

    expect(chunk2.loadFull).toHaveBeenCalledTimes(1);
    expect(getChunkLoadState(board, 1).fullLoadedCount).toBe(1);
  });

  test("两个 ChunkLoader 加载同一区块应增加引用计数", async () => {
    const { board, chunk2 } = createBoardHarness();

    await requestFullLoad(board, chunk2);
    await requestFullLoad(board, chunk2);

    expect(getChunkLoadState(board, 1).fullLoadedCount).toBe(2);
  });

  test("ChunkLoader 卸载后引用计数应减少", async () => {
    const { board, chunk1 } = createBoardHarness();

    const loader1 = await requestFullLoad(board, chunk1);
    const loader2 = await requestFullLoad(board, chunk1);

    expect(getChunkLoadState(board, 6).fullLoadedCount).toBe(2);

    await requestUnload(board, chunk1, loader1.requesterId);
    expect(getChunkLoadState(board, 6).fullLoadedCount).toBe(1);

    await requestUnload(board, chunk1, loader2.requesterId);
    expect(getChunkLoadState(board, 6).fullLoadedCount).toBe(0);
  });

  test("所有完整加载释放后区块应降级为临时加载（若仍有临时引用）", async () => {
    const { board, chunk2 } = createBoardHarness();

    const tempLoader = await requestTempLoad(board, chunk2);
    expect(chunk2.loadTemp).toHaveBeenCalledTimes(1);

    const fullLoader = await requestFullLoad(board, chunk2);
    expect(chunk2.loadFull).toHaveBeenCalledTimes(1);

    // 完整加载持有者释放 → 应降级为临时
    await requestUnload(board, chunk2, fullLoader.requesterId);
    expect(chunk2.downgradeToTemp).toHaveBeenCalledTimes(1);
    expect(getChunkLoadState(board, 1).fullLoadedCount).toBe(0);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(1);

    // 临时持有者释放 → 应完全卸载（unloadTemp）
    await requestUnload(board, chunk2, tempLoader.requesterId);
    expect(chunk2.unloadTemp).toHaveBeenCalledTimes(1);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(0);
  });

  test("同一 requester 重复发送 full 请求时引用计数不变", async () => {
    const { board, chunk2 } = createBoardHarness();

    const loader1 = await requestFullLoad(board, chunk2);
    expect(getChunkLoadState(board, 1).fullLoadedCount).toBe(1);

    // 同一 requester 再次请求 full → 引用计数不变
    const loader1Dup = boardCore.createChunkLoader(loader1.requesterId);
    loader1Dup.getChunkById(chunk2.id);
    boardCore.chunkLoadEventBus.emit(CHUNK_LOAD_EVENTS.REQUEST_LOAD, {
      requesterId: loader1.requesterId,
      chunk: chunk2,
      strategy: "full",
      direction: "none",
      source: "test",
      alreadyBuffered: false,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(getChunkLoadState(board, 1).fullLoadedCount).toBe(1);
  });

  test("临时加载升级为完整加载应由 loadFull 执行", async () => {
    const { board, chunk2 } = createBoardHarness();

    const loader = await requestTempLoad(board, chunk2);
    expect(chunk2.loadTemp).toHaveBeenCalledTimes(1);
    chunk2.loadFull.mockClear();

    // 同一 requester 从 temp 升级到 full
    boardCore.chunkLoadEventBus.emit(CHUNK_LOAD_EVENTS.REQUEST_LOAD, {
      requesterId: loader.requesterId,
      chunk: chunk2,
      strategy: "full",
      direction: "none",
      source: "test",
      alreadyBuffered: true,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(chunk2.loadFull).toHaveBeenCalledTimes(1);
    expect(getChunkLoadState(board, 1).fullLoadedCount).toBe(1);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(0);
  });

  test("memory board 不应卸载任何区块", async () => {
    const board = {};
    const chunk = Chunk.fromId(1);
    chunk.board = board;
    chunk.isLoad = true;
    chunk.isTempLoad = false;
    boardCore.chunkLoaded.set(chunk.id, {
      chunk,
      tempLoadedCount: 0,
      fullLoadedCount: 1,
      loaderStrategy: new Map([["board-root", "full"]]),
    });
    const unloadSpy = jest.spyOn(chunk, "unload").mockReturnValue(true);

    boardCore.chunkLoadEventBus.emit(CHUNK_LOAD_EVENTS.REQUEST_UNLOAD, {
      requesterId: "board-root",
      chunk,
      source: "test",
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(unloadSpy).not.toHaveBeenCalled();
    expect(boardCore.chunkLoaded.has(chunk.id)).toBe(true);
  });
});
