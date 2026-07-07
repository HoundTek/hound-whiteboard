/**
 * @file AOM 测试辅助函数
 * @description 提供 AOM（Active Object Manager）测试中通用的 fixtures 创建函数，
 *   减少 choose / operate / pickup / apply 等测试文件中的重复代码。
 * @module core/test-support/aom-fixtures
 * @author Zhou Chenyu
 */

import { Chunk } from "../shared/components/chunk/chunk.js";
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

export { createChunk, createChunkAt };
