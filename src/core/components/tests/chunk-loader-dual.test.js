import { jest } from "@jest/globals";
import os from "os";
import path from "path";

import { Directory } from "../../../utils/filesys/io.js";
import { Board } from "../board.js";
import { Chunk } from "../chunk.js";

describe("Multiple ChunkLoader", () => {
  function getChunkLoadState(board, chunkId) {
    return board.chunkLoaded.get(chunkId);
  }

  function createBoardHarness() {
    const board = new Board();
    const chunk1 = Chunk.fromId(6);
    const chunk2 = Chunk.fromId(1);
    const chunk3 = Chunk.fromId(2);

    for (const chunk of [chunk1, chunk2, chunk3]) {
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

    board.rootPath = path.join(os.tmpdir(), "houndwhiteboard-board-test");
    for (const chunk of [chunk1, chunk2, chunk3]) {
      board.chunkLoaded.set(chunk.id, {
        chunk,
        tempLoadedCount: 0,
        fullLoadedCount: 0,
        loaderStrategy: new Map(),
      });
    }
    const chunkLoader = board.createChunkLoader();

    return { board, chunkLoader, chunk1, chunk2, chunk3 };
  }

  test("ChunkLoader 的临时加载请求应由 Board 执行", () => {
    const { board, chunkLoader, chunk1, chunk2 } = createBoardHarness();

    chunkLoader.initChunk(chunk1);
    chunkLoader.expandBufferRightTempLoad();

    expect(chunk2.loadTemp).toHaveBeenCalledTimes(1);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(1);
    expect(chunkLoader.getLoadedChunks()).toEqual([chunk1, chunk2]);
  });

  test("完整加载升级应把区块从临时加载计数迁移到完整加载计数", () => {
    const { board, chunkLoader, chunk1, chunk2 } = createBoardHarness();

    chunkLoader.initChunk(chunk1);
    chunkLoader.expandBufferRightTempLoad();
    chunkLoader.forceMoveCurrentRightFullLoad();

    expect(chunk2.loadTemp).toHaveBeenCalledTimes(1);
    expect(chunk2.loadFull).toHaveBeenCalledTimes(1);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(0);
    expect(getChunkLoadState(board, 1).fullLoadedCount).toBe(1);
    expect(chunkLoader.chunkNow).toBe(chunk2);
  });

  test("缓冲区淘汰时应调用对应区块的卸载方法", () => {
    const { board, chunkLoader, chunk1, chunk2, chunk3 } = createBoardHarness();

    chunkLoader.chunksLoadedLimit = 2;
    chunkLoader.initChunk(chunk2);
    chunk2.isLoad = true;
    chunk2.isTempLoad = false;
    getChunkLoadState(board, 1).fullLoadedCount = 1;

    chunkLoader.expandBufferRightTempLoad();
    chunkLoader.forceMoveCurrentLeftFullLoad();

    expect(chunk3.unloadTemp).toHaveBeenCalledTimes(1);
    expect(chunkLoader.getLoadedChunks()).toEqual([chunk1, chunk2]);
    expect(getChunkLoadState(board, 2).tempLoadedCount).toBe(0);
  });

  test("多个 ChunkLoader 共用一区块时，单个卸载请求不应真正卸载该区块", () => {
    const { board, chunkLoader, chunk1, chunk2 } = createBoardHarness();
    const chunkLoader2 = board.createChunkLoader(2, "plm-2");

    chunkLoader.initChunk(chunk1);
    chunkLoader2.initChunk(chunk1);

    chunkLoader.expandBufferRightTempLoad();
    chunkLoader2.expandBufferRightTempLoad();

    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(2);

    const firstShrink = chunkLoader.shrinkBufferRight();

    expect(firstShrink).toBe(true);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(1);
    expect(chunk2.unloadTemp).not.toHaveBeenCalled();
    expect(chunk2.isLoad).toBe(true);

    const secondShrink = chunkLoader2.shrinkBufferRight();

    expect(secondShrink).toBe(true);
    expect(chunk2.unloadTemp).toHaveBeenCalledTimes(1);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(0);
    expect(chunk2.isLoad).toBe(false);
  });

  test("完整加载持有者释放后，若仍有临时持有者，应降级为临时加载", () => {
    const { board, chunkLoader, chunk1, chunk2 } = createBoardHarness();
    const chunkLoader2 = board.createChunkLoader(2, "plm-2");

    chunkLoader.initChunk(chunk1);
    chunkLoader2.initChunk(chunk1);

    chunkLoader.expandBufferRightFullLoad();
    chunkLoader2.expandBufferRightTempLoad();

    expect(getChunkLoadState(board, 1).fullLoadedCount).toBe(1);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(1);
    expect(chunk2.isTempLoad).toBe(false);

    const shrunk = chunkLoader.shrinkBufferRight();

    expect(shrunk).toBe(true);
    expect(chunk2.downgradeToTemp).toHaveBeenCalledTimes(1);
    expect(chunk2.unload).not.toHaveBeenCalled();
    expect(chunk2.unloadTemp).not.toHaveBeenCalled();
    expect(getChunkLoadState(board, 1).fullLoadedCount).toBe(0);
    expect(getChunkLoadState(board, 1).tempLoadedCount).toBe(1);
    expect(chunk2.isLoad).toBe(true);
    expect(chunk2.isTempLoad).toBe(true);
  });
});
