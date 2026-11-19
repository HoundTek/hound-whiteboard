/**
 * @file 持久化适配器契约与默认实现
 * @description BoardCore 与文件系统之间的注入缝：契约 typedef 与内存模式的无操作默认实现；真实实现由 io 包按布局注入。
 * @module kernel/board/persistence-adapter
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

/**
 * 持久化适配器
 * @description
 * BoardCore 的区块元数据与对象读写注入缝。
 * 内存模式使用 createDefaultPersistenceAdapter()（无操作）；
 * 文件模式由 io 包的 createPersistenceAdapter({ driver, rootId }) 实现，存储布局 chunks/{chunkId}.json、objects/{encodeURIComponent(id)}.json。
 * @typedef {Object} PersistenceAdapter
 * @property {(chunkId: number) => Promise<{ tierGraph: any[], objectCoverIndex: any[], objectTypes: Array<[string, string|null]> }>} loadChunkMetadata - 加载区块元数据（层叠图、覆盖索引与对象类型）
 * @property {(chunkId: number, metadata: { tierGraph: any[], objectCoverIndex: any[], objectTypes?: Array<[string, string|null]> }) => Promise<boolean>} saveChunkMetadata - 保存区块元数据
 * @property {(objectIds: string[]) => Promise<object[]>} loadObjects - 按 id 批量加载对象序列化数据
 * @property {(objects: object[]) => Promise<boolean>} saveObjects - 批量保存对象序列化数据
 * @property {(objectId: string) => Promise<boolean>} deleteObject - 删除对象序列化数据
 */

/**
 * 创建默认的持久化适配器（无操作实现）
 * @returns {PersistenceAdapter} 内存模式适配器
 */
function createDefaultPersistenceAdapter() {
  return {
    /**
     * 加载区块元数据
     * @param {number} _chunkId - 区块 id
     * @returns {Promise<{ tierGraph: any[], objectCoverIndex: any[], objectTypes: Array<[string, string|null]> }>} 空元数据
     */
    async loadChunkMetadata(_chunkId) {
      return { tierGraph: [], objectCoverIndex: [], objectTypes: [] };
    },

    /**
     * 保存区块元数据
     * @param {number} _chunkId - 区块 id
     * @param {{ tierGraph: any[], objectCoverIndex: any[], objectTypes?: Array<[string, string|null]> }} _metadata - 区块元数据
     * @returns {Promise<boolean>} 恒 true
     */
    async saveChunkMetadata(_chunkId, _metadata) {
      return true;
    },

    /**
     * 按对象 id 批量加载对象 JSON
     * @param {string[]} _objectIds - 对象 id 数组
     * @returns {Promise<object[]>} 空数组
     */
    async loadObjects(_objectIds) {
      return [];
    },

    /**
     * 批量保存对象 JSON
     * @param {object[]} _objects - 对象 plain object 数组
     * @returns {Promise<boolean>} 恒 true
     */
    async saveObjects(_objects) {
      return true;
    },

    /**
     * 删除对象 JSON
     * @param {string} _objectId - 对象 id
     * @returns {Promise<boolean>} 恒 true
     */
    async deleteObject(_objectId) {
      return true;
    },
  };
}

export { createDefaultPersistenceAdapter };
