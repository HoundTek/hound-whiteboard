/**
 * @file AOM 测试辅助函数
 * @description 提供 AOM（Active Object Manager）测试中通用的 fixtures 创建函数，
 *   减少 choose / operate / pickup / apply 等测试文件中的重复代码。
 * @module core/test-support/aom-fixtures
 * @author Zhou Chenyu
 */

import { createDefaultPersistenceAdapter } from "../bridges/persistence-adapter.js";
import { BoardCore } from "../worker/components/orchestration/board-core.js";
import { createDefaultAomRenderHooks } from "../worker/components/orchestration/aom-render-hooks.js";
import { Chunk } from "../worker/components/chunk/chunk.js";
import { CHUNK_LOAD_STRATEGIES } from "../worker/components/chunk/chunk-loader.js";
import { BasicObject } from "../shared/objects/basic-obj.js";
import { Vector } from "../utils/math.js";

/**
 * 按 ID 创建已加载的区块
 * @param {number} id - 区块 ID
 * @returns {Chunk}
 */
function createChunk(id) {
  const chunk = Chunk.fromId(id);
  chunk.isLoad = true;
  chunk.isTempLoad = false;
  return chunk;
}

/**
 * 按坐标创建已加载的区块
 * @param {number} x - 区块 X 坐标
 * @param {number} y - 区块 Y 坐标
 * @returns {Chunk}
 */
function createChunkAt(x, y) {
  const chunk = Chunk.fromCoordinate(x, y);
  chunk.isLoad = true;
  chunk.isTempLoad = false;
  return chunk;
}

/**
 * 确保 BoardCore 中指定区块已按给定策略装载
 * @param {BoardCore} boardCore - BoardCore 实例
 * @param {number} chunkId - 区块 ID
 * @param {{ strategy?: "temp" | "full" }} [options={}] - 加载选项
 * @returns {Chunk}
 */
function ensureBoardCoreChunkLoaded(boardCore, chunkId, options = {}) {
  if (!(boardCore instanceof BoardCore)) {
    throw new TypeError("Invalid BoardCore instance.");
  }

  const strategy = options.strategy ?? CHUNK_LOAD_STRATEGIES.FULL;
  const chunk = boardCore.getChunkById(chunkId);
  if (!(chunk instanceof Chunk)) {
    throw new Error(`Chunk ${chunkId} does not exist.`);
  }

  chunk.board = boardCore;
  chunk.isLoad = true;
  chunk.isTempLoad = strategy !== CHUNK_LOAD_STRATEGIES.FULL;
  chunk.loadStrategy = strategy;

  if (chunk.objectManager && !chunk.objectManager.board) {
    chunk.objectManager.setBoard(boardCore);
  }

  return chunk;
}

/**
 * 创建带已加载区块的 BoardCore AOM 测试夹具
 * @param {{
 *   width?: number,
 *   height?: number,
 *   rootPath?: string,
 *   chunkIds?: Iterable<number>,
 *   chunkStrategy?: "temp" | "full",
 *   aomRenderHooks?: import("../worker/components/orchestration/board-core.js").AomRenderHooks,
 *   persistenceAdapter?: import("../worker/components/orchestration/board-core.js").PersistenceAdapter,
 * }} [options={}] - BoardCore 初始化选项
 * @returns {{
 *   boardCore: BoardCore,
 *   chunks: Map<number, Chunk>,
 *   ensureLoadedChunk: (chunkId: number, options?: { strategy?: "temp" | "full" }) => Chunk,
 *   ensureLoadedChunks: (chunkIds: Iterable<number>, options?: { strategy?: "temp" | "full" }) => Map<number, Chunk>,
 *   seedBoardObject: (obj: BasicObject, options?: { coveredChunkIds?: Iterable<number> }) => BasicObject,
 * }}
 */
function createBoardCoreAomFixture(options = {}) {
  const boardCore = new BoardCore({
    width: options.width ?? 100,
    height: options.height ?? 100,
    rootPath: options.rootPath,
    aomRenderHooks: options.aomRenderHooks ?? createDefaultAomRenderHooks(),
    persistenceAdapter:
      options.persistenceAdapter ?? createDefaultPersistenceAdapter(),
  });
  const chunks = new Map();

  /**
   * 确保某个区块已加载并缓存到夹具索引
   * @param {number} chunkId - 区块 ID
   * @param {{ strategy?: "temp" | "full" }} [chunkOptions={}] - 区块加载选项
   * @returns {Chunk}
   */
  function ensureLoadedChunk(chunkId, chunkOptions = {}) {
    const chunk = ensureBoardCoreChunkLoaded(boardCore, chunkId, {
      strategy: chunkOptions.strategy ?? options.chunkStrategy,
    });
    chunks.set(chunkId, chunk);
    return chunk;
  }

  /**
   * 批量确保多个区块已加载
   * @param {Iterable<number>} chunkIds - 区块 ID 集合
   * @param {{ strategy?: "temp" | "full" }} [chunkOptions={}] - 区块加载选项
   * @returns {Map<number, Chunk>}
   */
  function ensureLoadedChunks(chunkIds, chunkOptions = {}) {
    const loadedChunks = new Map();
    for (const chunkId of chunkIds ?? []) {
      loadedChunks.set(chunkId, ensureLoadedChunk(chunkId, chunkOptions));
    }
    return loadedChunks;
  }

  /**
   * 将对象作为静态对象写入 BoardCore，并可显式覆盖其覆盖区块集合
   * @param {BasicObject} obj - 要写入的对象实例
   * @param {{ coveredChunkIds?: Iterable<number> }} [seedOptions={}] - 额外写入选项
   * @returns {BasicObject}
   */
  function seedBoardObject(obj, seedOptions = {}) {
    if (!(obj instanceof BasicObject)) {
      throw new TypeError("Invalid object instance.");
    }

    const ownerChunkId = Chunk.worldToChunkId(
      obj.position,
      boardCore.width,
      boardCore.height,
    );
    if (ownerChunkId == null) {
      throw new Error("Cannot resolve chunk for object position.");
    }

    ensureLoadedChunk(ownerChunkId);
    boardCore.addObject(obj);

    const coveredChunkIds = new Set(
      seedOptions.coveredChunkIds ??
        boardCore.getObjectCoverChunks(obj.id) ??
        [],
    );
    coveredChunkIds.add(ownerChunkId);
    boardCore.setObjectCoverChunks(obj.id, coveredChunkIds);

    for (const chunkId of coveredChunkIds) {
      const chunk = ensureLoadedChunk(chunkId);
      if (chunkId !== ownerChunkId) {
        chunk.addObject(obj.id);
      }
    }

    return obj;
  }

  ensureLoadedChunks(options.chunkIds ?? [], {
    strategy: options.chunkStrategy,
  });

  return {
    boardCore,
    chunks,
    ensureLoadedChunk,
    ensureLoadedChunks,
    seedBoardObject,
  };
}

/**
 * 创建 AOM 单元测试使用的 mock board
 * @description 返回轻量 board 对象供 new ActiveObjectManager(board) 使用，不涉及 BoardCore。
 * @param {Chunk[]} chunks - 区块实例数组
 * @param {{
 *   width?: number,
 *   height?: number,
 * }} [options={}] - mock board 选项
 * @returns {{
 *   width: number,
 *   height: number,
 *   getChunkById: (chunkId: number) => Chunk | undefined,
 *   getChunkByCoordinate: (x: number, y: number) => Chunk | undefined,
 *   createChunkLoader: () => {{ trackChunk: Function, emitLoadRequest: Function }},
 * }}
 */
function createMockBoard(chunks, options = {}) {
  const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return {
    width: options.width ?? 100,
    height: options.height ?? 100,
    getChunkById: (chunkId) => chunkMap.get(chunkId),
    getChunkByCoordinate: (x, y) => chunkMap.get(Chunk.coordinateToId(x, y)),
    createChunkLoader: () => ({
      trackChunk: () => {},
      emitLoadRequest: () => {},
    }),
  };
}

/**
 * 创建位于指定区块中心位置的对象
 * @param {number} id - 对象 id
 * @param {number} chunkId - 目标区块 id
 * @param {number} chunkSize - 区块尺寸
 * @returns {BasicObject}
 */
function createObjectInChunk(id, chunkId, chunkSize) {
  const coord = Chunk.idToCoordinate(chunkId);
  const pos = new Vector(
    coord.x * chunkSize + chunkSize / 2,
    coord.y * chunkSize + chunkSize / 2,
  );
  return new BasicObject(id, pos);
}

/**
 * 横向连接两个相邻区块
 * @param {Chunk} chunkA - 左侧区块
 * @param {Chunk} chunkB - 右侧区块
 */
function chunkConnect(chunkA, chunkB) {
  chunkA.rightChunk = chunkB;
  chunkB.leftChunk = chunkA;
}

/**
 * 纵向连接两个相邻区块
 * @param {Chunk} lowerChunk - 下侧区块
 * @param {Chunk} upperChunk - 上侧区块
 */
function verticalChunkConnect(lowerChunk, upperChunk) {
  lowerChunk.upChunk = upperChunk;
  upperChunk.downChunk = lowerChunk;
}

/**
 * 为指定区块集合中的目标对象批量设置覆盖区块索引
 * @param {Chunk[]} chunks - 区块实例数组
 * @param {number[]} objectIds - 对象 id 数组
 */
function setObjectCoverage(chunks, objectIds) {
  const chunkIds = chunks.map((item) => item.id);

  for (const targetChunk of chunks) {
    for (const objectId of objectIds) {
      targetChunk.objectManager.setObjectCoverChunks(objectId, chunkIds);
    }
  }
}

export {
  chunkConnect,
  createBoardCoreAomFixture,
  createChunk,
  createChunkAt,
  createMockBoard,
  createObjectInChunk,
  ensureBoardCoreChunkLoaded,
  setObjectCoverage,
  verticalChunkConnect,
};
