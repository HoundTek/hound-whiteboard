/**
 * @file 持久化适配器接口
 * @description 定义 BoardCore 与文件系统之间的注入式适配层，消除 BoardCore 对 file-operate-bridge-renderer 的直接依赖。
 * @module core/bridges/persistence-adapter
 * @author Zhou Chenyu
 */

/**
 * 创建默认的持久化适配器（无操作实现）
 * @description
 * 用作内存模式的默认适配器。UI 侧通过注入 `createRendererPersistenceAdapter()` 接通实际文件桥。
 * Worker 侧的适配器通过 UI host 转发 Tauri IPC 调用。
 *
 * @example
 * ```js
 * import { createRendererPersistenceAdapter } from "./persistence-adapter-renderer.js";
 * const adapter = createRendererPersistenceAdapter(boardRootPath);
 * const boardCore = new BoardCore({ persistenceAdapter: adapter, ... });
 * ```
 * @returns {PersistenceAdapter}
 */
function createDefaultPersistenceAdapter() {
  return {
    /**
     * 加载区块元数据
     * @param {number} _chunkId - 区块 id
     * @returns {Promise<{ tierGraph: any[], objectCoverIndex: any[] }>}
     */
    async loadChunkMetadata(_chunkId) {
      return { tierGraph: [], objectCoverIndex: [] };
    },

    /**
     * 保存区块元数据
     * @param {number} _chunkId - 区块 id
     * @param {{ tierGraph: any[], objectCoverIndex: any[] }} _metadata - 区块元数据
     * @returns {Promise<boolean>}
     */
    async saveChunkMetadata(_chunkId, _metadata) {
      return true;
    },

    /**
     * 按对象 ID 批量加载对象 JSON
     * @param {number[]} _objectIds - 对象 ID 数组
     * @returns {Promise<object[]>}
     */
    async loadObjects(_objectIds) {
      return [];
    },

    /**
     * 批量保存对象 JSON
     * @param {object[]} _objects - 对象 plain object 数组，每项必须含 id
     * @returns {Promise<boolean>}
     */
    async saveObjects(_objects) {
      return true;
    },

    /**
     * 删除指定对象 JSON
     * @param {number} _objectId - 对象 id
     * @returns {Promise<boolean>}
     */
    async deleteObject(_objectId) {
      return true;
    },
  };
}

/**
 * UI 线程版的持久化适配器工厂
 * @description 将请求委托给已存在的 `boardFileOperateBridge`。
 * 当前实现直接 import renderer bridge，未来 Worker 版通过 host 转发。
 * @param {string} rootPath - 白板根目录路径
 * @param {import("./file-operate-bridge-renderer.js").boardFileOperateBridge} fileBridge - 文件操作桥
 * @returns {PersistenceAdapter}
 */
function createRendererPersistenceAdapter(rootPath, fileBridge) {
  return {
    async loadChunkMetadata(chunkId) {
      return fileBridge.loadChunkMetadata(rootPath, chunkId);
    },

    async saveChunkMetadata(chunkId, metadata) {
      return fileBridge.saveChunkMetadata(rootPath, chunkId, metadata);
    },

    async loadObjects(objectIds) {
      return fileBridge.loadObjects(rootPath, objectIds);
    },

    async saveObjects(objects) {
      return fileBridge.saveObjects(rootPath, objects);
    },

    async deleteObject(objectId) {
      return fileBridge.deleteObject(rootPath, objectId);
    },
  };
}

export { createDefaultPersistenceAdapter, createRendererPersistenceAdapter };
