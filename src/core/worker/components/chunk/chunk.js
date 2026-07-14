/**
 * @file 区块组件
 * @description
 * 区块组件负责管理每一区块的对象和层级关系，以及区块的位置与唯一标识。
 * 每一区块对应一个区块类实例。
 * @module core/worker/components/chunk/chunk
 * @author Zhou Chenyu
 */

import { BasicObject } from "../../../shared/objects/basic-obj.js";
import { ChunkObjectManager } from "./chunk-object-manager.js";

/**
 * 区块类
 * @class
 * @description 每一区块对应一个区块类实例。
 * @author Zhou Chenyu
 */
class Chunk {
  /**
   * 所属白板核心
   * @type {import("../orchestration/board-core.js").BoardCore | undefined}
   */
  board;

  /**
   * 区块上的对象管理
   * @description 包括区块对象和层级关系
   * @type {ChunkObjectManager}
   */
  objectManager;

  /**
   * 区块唯一标识
   * @type {number}
   */
  id;

  /**
   * 区块二维坐标 x
   * @type {number}
   */
  x;

  /**
   * 区块二维坐标 y
   * @type {number}
   */
  y;

  /**
   * 左区块引用
   * @type {Chunk | undefined}
   */
  leftChunk;

  /**
   * 右区块引用
   * @type {Chunk | undefined}
   */
  rightChunk;

  /**
   * 上区块引用
   * @type {Chunk | undefined}
   */
  upChunk;

  /**
   * 下区块引用
   * @type {Chunk | undefined}
   */
  downChunk;

  /**
   * 区块是否已被加载到内存中
   * @type {boolean}
   */
  isLoad;

  /**
   * 区块是否是临时被加载
   * @description
   * 若是临时被加载，那么它应只加载对象层叠关系。
   * 若不是临时被加载，那它还会加载区块上所有对象。
   * @type {boolean}
   */
  isTempLoad;

  /**
   * 创建区块实例
   * @constructor
   * @param {number} chunkId - 区块 id
   */
  constructor(chunkId) {
    const coordinate = Chunk.idToCoordinate(chunkId);
    this.board = undefined;
    this.objectManager = undefined;
    this.id = chunkId;
    this.x = coordinate.x;
    this.y = coordinate.y;
    this.leftChunk = undefined;
    this.rightChunk = undefined;
    this.upChunk = undefined;
    this.downChunk = undefined;
    this.isLoad = false;
    this.isTempLoad = false;
  }

  /**
   * 通过区块 id 创建区块实例
   * @param {number} chunkId - 区块 id
   * @returns {Chunk}
   */
  static fromId(chunkId) {
    return new Chunk(chunkId);
  }

  /**
   * 通过二维坐标创建区块实例
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {Chunk}
   */
  static fromCoordinate(x, y) {
    const chunkId = Chunk.coordinateToId(x, y);
    return new Chunk(chunkId);
  }

  /**
   * 回字形 id 转二维坐标
   * @param {number} chunkId - 区块 id
   * @returns {{x: number, y: number}} 区块二维坐标
   */
  static idToCoordinate(chunkId) {
    if (!Number.isInteger(chunkId) || chunkId <= 0) {
      throw new Error("Invalid chunk id.");
    }

    if (chunkId === 1) {
      return { x: 0, y: 0 };
    }

    const radius = Math.ceil((Math.sqrt(chunkId) - 1) / 2);
    const maxId = (2 * radius + 1) ** 2;
    const diff = maxId - chunkId;
    const edgeLength = radius * 2;

    if (diff < edgeLength) {
      return { x: radius - diff, y: -radius };
    }
    if (diff < edgeLength * 2) {
      return {
        x: -radius,
        y: -radius + (diff - edgeLength),
      };
    }
    if (diff < edgeLength * 3) {
      return {
        x: -radius + (diff - edgeLength * 2),
        y: radius,
      };
    }
    return {
      x: radius,
      y: radius - (diff - edgeLength * 3),
    };
  }

  /**
   * 二维坐标转回字形 id
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {number}
   */
  static coordinateToId(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error("Invalid chunk coordinate.");
    }

    const radius = Math.max(Math.abs(x), Math.abs(y));
    if (radius === 0) {
      return 1;
    }

    const maxId = (2 * radius + 1) ** 2;
    let diff = 0;

    if (y === -radius) {
      diff = radius - x;
    } else if (x === -radius) {
      diff = radius * 2 + (y + radius);
    } else if (y === radius) {
      diff = radius * 4 + (x + radius);
    } else if (x === radius) {
      diff = radius * 6 + (radius - y);
    } else {
      throw new Error("Coordinate is not on a valid spiral ring.");
    }

    return maxId - diff;
  }

  /**
   * 判断区块 id 与二维坐标是否匹配
   * @param {number} chunkId - 区块 id
   * @param {number} x - 区块二维坐标 x
   * @param {number} y - 区块二维坐标 y
   * @returns {boolean}
   */
  static isValidChunkIdentity(chunkId, x, y) {
    if (
      !Number.isInteger(chunkId) ||
      chunkId <= 0 ||
      !Number.isInteger(x) ||
      !Number.isInteger(y)
    ) {
      return false;
    }

    const coordinate = Chunk.idToCoordinate(chunkId);
    return coordinate.x === x && coordinate.y === y;
  }

  /**
   * 判断当前区块是否合法
   * @returns {boolean}
   */
  isValid() {
    return Chunk.isValidChunkIdentity(this.id, this.x, this.y);
  }

  /**
   * 断言当前区块合法
   * @throws {Error} 若当前区块不合法，则抛出错误
   */
  assertValid() {
    if (!this.isValid()) {
      throw new Error("Invalid chunk identity.");
    }
  }

  /**
   * 世界坐标到区块 id
   * @param {Vector|{x:number,y:number}} worldPos - 世界坐标
   * @param {number} chunkWidth - 区块宽
   * @param {number} chunkHeight - 区块高
   * @returns {number|undefined}
   */
  static worldToChunkId(worldPos, chunkWidth, chunkHeight) {
    if (
      !worldPos ||
      typeof chunkWidth !== "number" ||
      !Number.isFinite(chunkWidth) ||
      chunkWidth <= 0 ||
      typeof chunkHeight !== "number" ||
      !Number.isFinite(chunkHeight) ||
      chunkHeight <= 0
    ) {
      return undefined;
    }
    if (typeof worldPos.x !== "number" || typeof worldPos.y !== "number") {
      return undefined;
    }
    const x = Math.floor(worldPos.x / chunkWidth);
    const y = Math.floor(worldPos.y / chunkHeight);
    return Chunk.coordinateToId(x, y);
  }

  /**
   * 连接两区块
   * @param {Chunk | undefined} first - 第一区块
   * @param {Chunk | undefined} second - 第二区块
   * @param {"right" | "left" | "up" | "down"} [direction = "right"] - second 相对 first 的方向，默认左右相邻
   * @description
   * 该方法会在 first 和 second 之间建立双向连接。
   * 仅更新区块之间的引用关系，不会判断或修改区块的二维坐标或 id。
   */
  static connectTwoChunk(first, second, direction = "right") {
    if (!first || !second) return;

    const directions = {
      right: ["rightChunk", "leftChunk"],
      left: ["leftChunk", "rightChunk"],
      up: ["upChunk", "downChunk"],
      down: ["downChunk", "upChunk"],
    };
    const pair = directions[direction];
    if (!pair) {
      throw new Error("Invalid chunk connection direction.");
    }

    first[pair[0]] = second;
    second[pair[1]] = first;
  }

  /**
   * 添加对象并更新层叠图
   *
   * @param {BasicObject | number} obj - 要添加的对象或对象 id
   * @param {number[]} [below = []] - 应在该对象之下的对象
   * @param {number[]} [above = []] - 应在该对象之上的对象
   */
  addObject(obj, below = [], above = []) {
    if (!this.objectManager) {
      this.objectManager = new ChunkObjectManager(this.id, this.board);
    } else if (!this.objectManager.board && this.board) {
      this.objectManager.setBoard(this.board);
    }

    const graph = this.objectManager.staticGraph;
    const objectId = obj instanceof BasicObject ? obj.id : obj;

    if (obj instanceof BasicObject) {
      this.board?.registerObjectInstance?.(obj);
    }

    if (!graph.hasNode(objectId)) {
      graph.addNodeUnsafe(objectId);
    }

    for (const from of below) {
      if (!graph.hasNode(from)) continue; // 在其它区块，不管
      graph.addEdgeUnsafe(from, objectId);
    }
    for (const to of above) {
      if (!graph.hasNode(to)) continue; // 在其它区块，不管
      graph.addEdgeUnsafe(objectId, to);
    }
  }

  /**
   * 从区块静态图中移除对象
   * @param {number} objectId - 要移除的对象 id
   */
  removeObject(objectId) {
    if (!this.objectManager) return;
    const graph = this.objectManager.staticGraph;
    if (graph.hasNode(objectId)) {
      graph.deleteNodeUnsafe(objectId);
    }
    this.objectManager.unsetObjectCoverChunks?.(objectId);
  }

  /**
   * 完整加载该区块
   * @description
   * @param {string} boardRootPath - 白板根目录
   * @todo
   * @returns {Promise<boolean>} 是否成功
   */
  async loadFull(boardRootPath) {
    // 已完整加载
    if (this.isLoad && !this.isTempLoad) return false;

    // 未加载，升级为临时加载
    if (!this.isLoad) await this.loadTemp(boardRootPath);
    this.isTempLoad = false;
    return true;
  }

  /**
   * 完整卸载该区块
   * @returns {boolean} 是否成功卸载
   * @description
   * 该方法会把该区块变成未加载状态。
   * 无论该区块之前是完整加载还是临时加载，调用后都会变成未加载状态。
   */
  unload() {
    if (this.objectManager) this.objectManager.unload();
    this.objectManager = undefined;
    this.isLoad = false;
    this.isTempLoad = false;
    return true;
  }

  /**
   * 卸载临时加载区块
   * @returns {boolean} 是否成功卸载
   */
  unloadTemp() {
    if (!this.isLoad || !this.isTempLoad) {
      return false;
    }
    return this.unload();
  }

  /**
   * 从完整加载降级为临时加载
   * @returns {boolean} 是否成功降级
   * @description
   * 该方法会保留层叠图，只卸载完整加载阶段持有的对象内容。
   * 若当前区块不是完整加载状态，则不进行任何操作。
   */
  downgradeToTemp() {
    if (!this.isLoad || this.isTempLoad) {
      return false;
    }
    this.isTempLoad = true;
    return true;
  }

  /**
   * 临时加载该区块
   * @param {string} boardRootPath - 白板根目录
   * @returns {Promise<boolean>} 是否成功
   */
  async loadTemp(boardRootPath) {
    if (this.isLoad) {
      // 已加载，不管是完整加载还是临时加载，都不能重复加载
      return false;
    }
    this.isLoad = true;
    this.isTempLoad = true;
    if (!this.objectManager) {
      this.objectManager = new ChunkObjectManager(this.id, this.board);
    } else if (!this.objectManager.board && this.board) {
      this.objectManager.setBoard(this.board);
    }
    await this.objectManager.loadChunkMetadata(boardRootPath);
    return true;
  }
}

export { Chunk };
