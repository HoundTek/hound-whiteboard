/**
 * @file 持久化适配器
 * @description 实现 kernel 的 PersistenceAdapter 契约（区块元数据 / 对象批量读写），底层经 IoDriver 执行。
 * @module io/adapter/persistence
 * @author Zhou Chenyu
 */

import { joinRel } from "../core/dsl.js";
import { bindRoot } from "../driver/io-driver.js";

/**
 * 创建持久化适配器
 * @param {Object} params - 参数
 * @param {import("../driver/io-driver.js").IoDriver} params.driver - IoDriver 实现
 * @param {string} params.rootId - 白板根目录 id
 * @returns {Object} PersistenceAdapter 契约实现
 *
 * @description
 * 存储布局：
 * - 区块元数据：{root}/chunks/{chunkId}.json，内容 { tierGraph, objectCoverIndex, objectTypes }
 * - 对象：{root}/objects/{encodeURIComponent(objectId)}.json，扁平存储每对象一文件
 *   （与 session-store 同一命名，布局 v2 下对象文件由日志跟随者代写，本适配器负责区块卸载/重载路径）
 */
export const createPersistenceAdapter = ({ driver, rootId }) => {
  /** @type {Object} 绑定 rootId 的驱动窄接口 */
  const d = bindRoot(driver, rootId);

  /**
   * 拼接区块元数据相对路径
   * @param {number} chunkId - 区块 id
   * @returns {string|null} 相对路径或 null
   */
  const chunkMetaRel = (chunkId) => {
    if (!Number.isInteger(chunkId)) return null;
    return joinRel("chunks", { __type: "File", name: String(chunkId), ext: "json" });
  };

  /**
   * 拼接对象相对路径
   * @description 对象 id 是字符串（形如 "{source}/{n}"），文件名经 encodeURIComponent
   * 与 session-store 同一命名；非法 id 显式抛错（静默 null 曾掩盖契约断裂）。
   * @param {string} objectId - 对象 id
   * @returns {string} 相对路径
   * @throws {TypeError} objectId 不是非空字符串时抛出
   */
  const objectRel = (objectId) => {
    if (typeof objectId !== "string" || objectId.length === 0) {
      throw new TypeError(`对象 id 必须是非空字符串：${String(objectId)}`);
    }
    return joinRel("objects", {
      __type: "File",
      name: encodeURIComponent(objectId),
      ext: "json",
    });
  };

  return {
    /**
     * 加载区块元数据
     * @param {number} chunkId - 区块 id
     * @returns {Promise<{tierGraph: any[], objectCoverIndex: any[], objectTypes: Array<[string, string|null]>}>} 区块元数据
     */
    async loadChunkMetadata(chunkId) {
      const rel = chunkMetaRel(chunkId);
      if (rel === null) return { tierGraph: [], objectCoverIndex: [], objectTypes: [] };

      const content = await d.read(rel);
      if (content === null) return { tierGraph: [], objectCoverIndex: [], objectTypes: [] };

      try {
        const data = JSON.parse(content);
        return {
          tierGraph: Array.isArray(data?.tierGraph) ? data.tierGraph : [],
          objectCoverIndex: Array.isArray(data?.objectCoverIndex)
            ? data.objectCoverIndex
            : [],
          objectTypes: Array.isArray(data?.objectTypes) ? data.objectTypes : [],
        };
      } catch {
        return { tierGraph: [], objectCoverIndex: [], objectTypes: [] };
      }
    },

    /**
     * 保存区块元数据
     * @param {number} chunkId - 区块 id
     * @param {{tierGraph: any[], objectCoverIndex: any[], objectTypes?: Array<[string, string|null]>}} metadata - 区块元数据
     * @returns {Promise<boolean>} 是否成功
     */
    async saveChunkMetadata(chunkId, metadata) {
      const rel = chunkMetaRel(chunkId);
      if (rel === null || !metadata || !Array.isArray(metadata.tierGraph)) {
        return false;
      }

      const content = JSON.stringify({
        tierGraph: metadata.tierGraph,
        objectCoverIndex: Array.isArray(metadata.objectCoverIndex)
          ? metadata.objectCoverIndex
          : [],
        objectTypes: Array.isArray(metadata.objectTypes)
          ? metadata.objectTypes
          : [],
      });

      return d.write(rel, content);
    },

    /**
     * 按对象 ID 批量加载对象 JSON
     * @param {string[]} objectIds - 对象 ID 数组
     * @returns {Promise<object[]>} 对象数组（跳过缺失对象）
     */
    async loadObjects(objectIds) {
      if (!Array.isArray(objectIds)) return [];

      const results = await Promise.all(
        objectIds.map(async (objectId) => {
          const rel = objectRel(objectId);
          const content = await d.read(rel);
          if (content === null) return null;
          try {
            return JSON.parse(content);
          } catch {
            return null;
          }
        })
      );

      return results.filter((obj) => obj !== null);
    },

    /**
     * 批量保存对象 JSON（扁平存储，每对象一文件）
     * @param {object[]} objects - 对象 plain object 数组，每项必须含字符串 id
     * @returns {Promise<boolean>} 是否成功
     */
    async saveObjects(objects) {
      if (!Array.isArray(objects)) return false;

      const results = await Promise.all(
        objects.map(async (objectData) => {
          const rel = objectRel(objectData?.id);
          return d.write(rel, JSON.stringify(objectData));
        })
      );

      return results.every(Boolean);
    },

    /**
     * 删除对象 JSON
     * @param {string} objectId - 对象 id
     * @returns {Promise<boolean>} 是否成功
     */
    async deleteObject(objectId) {
      const rel = objectRel(objectId);
      return d.rm(rel);
    },
  };
};
