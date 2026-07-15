/**
 * @file 区块静态对象管理器
 * @description 区块静态对象管理器负责维护区块对象层级关系和覆盖索引。
 * @module core/engine/chunk/chunk-object-manager
 * @author Zhou Chenyu
 */

import { DirectedGraph } from "../utils/directed-graph.js";
import { BasicObject } from "../objects/basic-obj.js";
import { boardFileOperateBridge } from "../../bridges/file-operate-bridge-renderer.js";
import {
  intersectsRanges,
  RectangleRange,
} from "../range/index.js";
import { Chunk } from "./chunk.js";

/**
 * 区块静态对象管理器
 * @class
 * @author Zhou Chenyu
 */
class ChunkObjectManager {
  /**
   * 该区块的静态图
   * @description 见 [tier-graph-document.md](./docs/tier-graph-document.md)。
   * 内部存储所有对象的层叠关系，包含在该区块的对象（可以不属于该区块）。存储对象 id，不拥有对象实例的所有权。
   * @type {DirectedGraph<number>}
   */
  staticGraph;

  /**
   * 所属白板核心
   * @type {import("../orchestration/board-core.js").BoardCore | undefined}
   */
  board;

  /**
   * 区块 id
   * @type {number}
   */
  id;

  /**
   * @param {number} chunkId - 区块 id
   * @param {import("../orchestration/board-core.js").BoardCore} [board] - Worker 端白板实例
   */
  constructor(chunkId, board) {
    this.id = chunkId;
    this.board = board;
    this.staticGraph = new DirectedGraph();
  }

  /**
   * 绑定白板实例
   * @param {import("../orchestration/board-core.js").BoardCore} board - Worker 端白板实例
   */
  setBoard(board) {
    this.board = board;
  }

  /**
   * 通过 Board 间接获取对象实例
   * @param {number} objectId - 对象 id
   * @returns {BasicObject | undefined}
   */
  getObject(objectId) {
    return this.board?.getObjectById?.(objectId);
  }

  /**
   * 设置对象覆盖区块集合
   * @description 委托到 BoardCore 的唯一覆盖索引。
   * @param {number} objectId - 对象 id
   * @param {Iterable<number>} chunkIds - 覆盖区块 id 集合
   */
  setObjectCoverChunks(objectId, chunkIds) {
    const normalizedChunkIds = new Set();
    for (const chunkId of chunkIds) {
      if (!Number.isInteger(chunkId) || chunkId <= 0) {
        throw new Error("Invalid covered chunk id.");
      }
      normalizedChunkIds.add(chunkId);
    }
    this.board?.setObjectCoverChunks?.(objectId, normalizedChunkIds);
  }

  /**
   * 删除对象的覆盖区块索引
   * @param {number} objectId - 对象 id
   */
  unsetObjectCoverChunks(objectId) {
    this.board?.unsetObjectCoverChunks?.(objectId);
  }

  /**
   * 获取对象覆盖区块集合
   * @description 委托到 BoardCore 的唯一覆盖索引。
   * @param {number} objectId - 对象 id
   * @returns {Set<number>}
   */
  getObjectCoverChunks(objectId) {
    return new Set(this.board?.getObjectCoverChunks?.(objectId) ?? []);
  }

  /**
   * 创建指定区块坐标对应的区块范围
   * @param {number} chunkX - 区块坐标 x
   * @param {number} chunkY - 区块坐标 y
   * @param {number} chunkWidth - 区块宽
   * @param {number} chunkHeight - 区块高
   * @returns {RectangleRange}
   */
  static createChunkRange(chunkX, chunkY, chunkWidth, chunkHeight) {
    return new RectangleRange(
      chunkX * chunkWidth,
      chunkY * chunkHeight,
      chunkWidth,
      chunkHeight,
    );
  }

  /**
   * 计算一个世界坐标范围覆盖到的区块 id 集合
   * @param {import("../../../shared/range/range.js").Range} worldRange - 世界坐标范围
   * @param {number} chunkWidth - 区块宽
   * @param {number} chunkHeight - 区块高
   * @param {{approximationSegments?: number}} [options] - range 几何计算参数
   * @returns {Set<number>}
   */
  static calculateCoveredChunkIdsForRange(
    worldRange,
    chunkWidth,
    chunkHeight,
    options = {},
  ) {
    if (!(worldRange instanceof Object) || worldRange == null) {
      throw new Error("Invalid world range.");
    }
    if (chunkWidth <= 0 || chunkHeight <= 0) {
      throw new Error("Invalid chunk size.");
    }

    const worldBoundingBox = RectangleRange.from(worldRange);
    const minChunkX = Math.floor(worldBoundingBox.left / chunkWidth);
    const maxChunkX = Math.floor(
      (worldBoundingBox.left + worldBoundingBox.width) / chunkWidth,
    );
    const minChunkY = Math.floor(worldBoundingBox.top / chunkHeight);
    const maxChunkY = Math.floor(
      (worldBoundingBox.top + worldBoundingBox.height) / chunkHeight,
    );

    const chunkIds = new Set();
    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
        const chunkRange = ChunkObjectManager.createChunkRange(
          chunkX,
          chunkY,
          chunkWidth,
          chunkHeight,
        );
        if (!intersectsRanges(worldRange, chunkRange, options)) {
          continue;
        }
        chunkIds.add(Chunk.coordinateToId(chunkX, chunkY));
      }
    }

    return chunkIds;
  }

  /**
   * 根据对象 range 重新计算其覆盖区块集合并写入索引
   * @param {BasicObject} obj - 对象实例
   * @param {number} chunkWidth - 区块宽
   * @param {number} chunkHeight - 区块高
   * @param {{approximationSegments?: number}} [options] - range 几何计算参数
   * @returns {Set<number>}
   */
  syncObjectCoverChunksForObject(obj, chunkWidth, chunkHeight, options = {}) {
    if (!(obj instanceof BasicObject)) {
      throw new Error("Invalid object instance.");
    }

    const worldRange = obj.getRange().withPosition(obj.position);
    const chunkIds = ChunkObjectManager.calculateCoveredChunkIdsForRange(
      worldRange,
      chunkWidth,
      chunkHeight,
      options,
    );

    if (chunkIds.size === 0) {
      chunkIds.add(this.id);
    }

    this.setObjectCoverChunks(obj.id, chunkIds);
    return chunkIds;
  }

  /**
   * 将对象覆盖区块索引序列化为可持久化结构
   * @description 有 BoardCore 时覆盖索引由 BoardCore 统一管理，不由 COM 序列化。
   * @returns {Array<[number, number[]]>}
   */
  serializeObjectCoverChunks() {
    return [];
  }

  /**
   * 从可持久化结构恢复对象覆盖区块索引
   * @param {Array<[number, number[]]>} coverIndexData - 覆盖索引数据
   */
  loadObjectCoverChunksFromData(coverIndexData) {
    for (const entry of coverIndexData || []) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error("Invalid object cover index entry.");
      }

      const [objectId, chunkIds] = entry;
      if (!Number.isInteger(objectId)) {
        throw new Error("Invalid object id in cover index.");
      }

      this.setObjectCoverChunks(objectId, chunkIds || []);
    }
  }

  /**
   * 加载区块元数据（层叠图 + 覆盖索引）
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 加载完成
   * @description
   * 一次 IPC 读取合并后的 chunks/{chunkId}.json。
   */
  async loadChunkMetadata(boardRootPath) {
    if (typeof boardRootPath !== "string" || boardRootPath.trim() === "") {
      return;
    }

    const { tierGraph, objectCoverIndex } =
      await boardFileOperateBridge.loadChunkMetadata(boardRootPath, this.id);

    this.staticGraph = DirectedGraph.parse(tierGraph);
    this.loadObjectCoverChunksFromData(objectCoverIndex);
  }

  /**
   * 保存区块元数据（层叠图 + 覆盖索引）
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 保存完成
   */
  async saveChunkMetadata(boardRootPath) {
    if (typeof boardRootPath !== "string" || boardRootPath.trim() === "") {
      return;
    }

    await boardFileOperateBridge.saveChunkMetadata(boardRootPath, this.id, {
      tierGraph: this.staticGraph.toArray(),
      objectCoverIndex: this.serializeObjectCoverChunks(),
    });
  }

  /**
   * 卸载层叠图
   * @description 仅释放层叠图，保留对象映射。
   */
  unloadTierGraph() {
    this.staticGraph = new DirectedGraph();
  }

  /**
   * 加载该区块的所有对象
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 加载完成
   */
  async loadObjects(boardRootPath) {
    await this.board?.loadChunkObjectEntries?.(this.id, boardRootPath);
  }

  /**
   * 保存该区块的所有对象
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 保存完成
   */
  async saveObjects(boardRootPath) {
    await this.board?.saveChunkObjectEntries?.(this.id, boardRootPath);
  }

  /**
   * 卸载该区块的所有对象
   * @description 释放对象实例映射。
   */
  unloadObjects() {
    this.board?.unloadChunkObjectEntries?.(this.id);
  }

  /**
   * 卸载该区块全部数据
   * @description 统一释放层叠图与对象映射。
   */
  unload() {
    this.unloadObjects();
    this.unloadTierGraph();
  }
}

export { ChunkObjectManager };
