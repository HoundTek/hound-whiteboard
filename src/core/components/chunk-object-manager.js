/**
 * 区块静态对象管理器
 * @module chunk-object-manager
 * @author Zhou Chenyu
 */

import { DirectedGraph } from "../utils/directed-graph.js";
import { BasicObject } from "../objects/basic-obj.js";
import { boardFileOperateBridge } from "../bridges/file-operate-bridge-renderer.js";
import { intersectsRanges, RectangleRange } from "../range/index.js";
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
   * @type {DirectedGraph}
   */
  staticGraph;

  /**
   * 对象覆盖区块集合索引
   * @description 对象 id -> 覆盖到的区块 id 集合。
   * @type {Map<number, Set<number>>}
   */
  objectCoverChunks;

  /**
   * 所属白板
   * @type {import("./board.js").Board | undefined}
   */
  board;

  /**
   * 区块 id
   * @type {number}
   */
  id;

  constructor(chunkId, board) {
    this.id = chunkId;
    this.board = board;
    this.staticGraph = new DirectedGraph();
    this.objectCoverChunks = new Map();
  }

  /**
   * 绑定白板实例
   * @param {import("./board.js").Board} board - 白板实例
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
    this.objectCoverChunks.set(objectId, normalizedChunkIds);
  }

  /**
   * 获取对象覆盖区块集合
   * @param {number} objectId - 对象 id
   * @returns {Set<number>}
   */
  getObjectCoverChunks(objectId) {
    return new Set(this.objectCoverChunks.get(objectId) || []);
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
   * @param {import("../range/range.js").Range} worldRange - 世界坐标范围
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
      chunkIds.add(obj.ownerChunkId);
    }

    this.setObjectCoverChunks(obj.id, chunkIds);
    return chunkIds;
  }

  /**
   * 根据当前区块对象映射重建所有对象覆盖区块索引
   * @param {number} chunkWidth - 区块宽
   * @param {number} chunkHeight - 区块高
   * @param {{approximationSegments?: number}} [options] - range 几何计算参数
   * @returns {Map<number, Set<number>>}
   */
  syncAllObjectCoverChunks(chunkWidth, chunkHeight, options = {}) {
    this.objectCoverChunks.clear();
    for (const objectId of this.staticGraph.getNodes()) {
      const obj = this.getObject(objectId);
      if (!(obj instanceof BasicObject)) continue;
      this.syncObjectCoverChunksForObject(
        obj,
        chunkWidth,
        chunkHeight,
        options,
      );
    }
    return new Map(this.objectCoverChunks);
  }

  /**
   * 将对象覆盖区块索引序列化为可持久化结构
   * @returns {Array<[number, number[]]>}
   */
  serializeObjectCoverChunks() {
    return Array.from(this.objectCoverChunks.entries())
      .map(([objectId, chunkIds]) => [
        objectId,
        Array.from(chunkIds).sort((left, right) => left - right),
      ])
      .sort((left, right) => left[0] - right[0]);
  }

  /**
   * 从可持久化结构恢复对象覆盖区块索引
   * @param {Array<[number, number[]]>} coverIndexData - 覆盖索引数据
   */
  loadObjectCoverChunksFromData(coverIndexData) {
    this.objectCoverChunks.clear();
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
   * 加载层叠图
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 加载完成
   * @description
   * 该方法只加载层叠图，不加载对象实例。
   * @throws {Error} 如果文件不存在
   */
  async loadTierGraph(boardRootPath) {
    // 通过专用 IPC 从主进程读取层叠图数据。
    const graphData = await boardFileOperateBridge.loadTierGraph(
      boardRootPath,
      this.id,
    );
    const coverIndexData =
      await boardFileOperateBridge.loadChunkObjectCoverIndex(
        boardRootPath,
        this.id,
      );
    // 渲染侧只负责把 plain object 转回 DirectedGraph。
    this.staticGraph = DirectedGraph.parse(graphData);
    this.loadObjectCoverChunksFromData(coverIndexData);
  }

  /**
   * 保存层叠图
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<void>} 保存完成
   */
  async saveTierGraph(boardRootPath) {
    // 统一以数组结构落盘，避免传输复杂实例对象。
    await boardFileOperateBridge.saveTierGraph(
      boardRootPath,
      this.id,
      this.staticGraph.toArray(),
    );
    await boardFileOperateBridge.saveChunkObjectCoverIndex(
      boardRootPath,
      this.id,
      this.serializeObjectCoverChunks(),
    );
  }

  /**
   * 卸载层叠图
   * @description 仅释放层叠图，保留对象映射。
   */
  unloadTierGraph() {
    this.staticGraph = new DirectedGraph();
    this.objectCoverChunks.clear();
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

  /**
   * 解析区块对象目录
   * @param {Directory} root - 白板根目录
   * @returns {Directory} 对象目录，如果根目录不存在或无法访问，则返回 undefined
   * @description 对象目录位于白板根目录下的 `objects/chunk{chunkId}/`。
   */
  resolveObjectsDirectory(root) {
    if (!root) return undefined;
    return root.cd("objects").cd("chunk" + this.id.toString());
  }

  /**
   * 解析区块层叠图文件位置
   * @param {Directory} root - 白板根目录
   * @returns {File} 层叠图文件，如果根目录不存在或无法访问，则返回 undefined
   * @description 层叠图文件位于白板根目录下的 `chunks/{chunkId}.json`。
   */
  resolveTierGraphFile(root) {
    if (!root) return undefined;
    return root.cd("chunks").peek(this.id.toString(), "json");
  }
}

export { ChunkObjectManager };
