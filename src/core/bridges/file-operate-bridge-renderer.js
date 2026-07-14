/**
 * @file Core 文件操作渲染器桥接
 * @description 提供渲染进程调用 Core 文件操作的接口（待 Tauri IO 桥实现后接入）。
 * @module core/bridges/file-operate-bridge-renderer
 * @author Zhou Chenyu
 */

import { CORE_FILE_OPERATE_ACTIONS } from "./file-operate-bridge-common.js";

const NOT_IMPLEMENTED_ERROR = "IO bridge not yet implemented for Tauri";

/**
 * 调用 Core 文件操作 IPC。
 * @param {string} action - 动作名
 * @param {any} payload - 动作参数
 * @returns {Promise<any>}
 */
async function callCoreFileOperate(action, payload) {
  throw new Error(`${NOT_IMPLEMENTED_ERROR}: ${action}`);
}

/**
 * Board/Chunk 相关文件操作桥。
 */
const boardFileOperateBridge = {
  /**
   * 创建白板根目录
   * @param {string} rootPath - 白板根目录路径
   * @param {object} boardMeta - 白板元信息
   * @param {object} config - 白板配置
   * @returns {Promise<boolean>} 是否成功创建
   */
  createBoardRoot(rootPath, boardMeta, config) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT, {
      rootPath,
      boardMeta,
      config,
    });
  },

  /**
   * 创建区块存储文件
   * @param {string} rootPath - 白板根目录路径
   * @param {number} chunkId - 区块 id
   * @returns {Promise<boolean>} 是否成功创建
   */
  createChunkStorage(rootPath, chunkId) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.CREATE_CHUNK_STORAGE, {
      rootPath,
      chunkId,
    });
  },

  /**
   * 写入区块连接信息
   * @param {string} rootPath - 白板根目录路径
   * @param {object} connection - 区块连接信息
   * @returns {Promise<boolean>} 是否成功写入
   */
  writeChunkConnection(rootPath, connection) {
    return callCoreFileOperate(
      CORE_FILE_OPERATE_ACTIONS.WRITE_CHUNK_CONNECTION,
      {
        rootPath,
        connection,
      },
    );
  },

  /**
   * 写入白板打开轨迹
   * @param {string} rootPath - 白板根目录路径
   * @param {object} trace - 白板打开轨迹
   * @returns {Promise<boolean>} 是否成功写入
   */
  writeTrace(rootPath, trace) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.WRITE_TRACE, {
      rootPath,
      trace,
    });
  },

  /**
   * 加载白板快照
   * @param {string} rootPath - 白板根目录路径
   * @param {object} expectedBoardMeta - 预期的白板元信息
   * @returns {Promise<object>} 白板快照数据
   */
  loadBoardSnapshot(rootPath, expectedBoardMeta) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.LOAD_BOARD_SNAPSHOT, {
      rootPath,
      expectedBoardMeta,
    });
  },

  /**
   * 加载指定区块的元数据（层叠图 + 覆盖索引）
   * @param {string} rootPath - 白板根目录路径
   * @param {number} chunkId - 区块 id
   * @returns {Promise<{ tierGraph: any[], objectCoverIndex: any[] }>}
   */
  loadChunkMetadata(rootPath, chunkId) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.LOAD_CHUNK_METADATA, {
      rootPath,
      chunkId,
    });
  },

  /**
   * 保存指定区块的元数据（层叠图 + 覆盖索引）
   * @param {string} rootPath - 白板根目录路径
   * @param {number} chunkId - 区块 id
   * @param {{ tierGraph: any[], objectCoverIndex: any[] }} metadata - 区块元数据
   * @returns {Promise<boolean>} 是否成功保存
   */
  saveChunkMetadata(rootPath, chunkId, metadata) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.SAVE_CHUNK_METADATA, {
      rootPath,
      chunkId,
      tierGraph: metadata?.tierGraph ?? [],
      objectCoverIndex: metadata?.objectCoverIndex ?? [],
    });
  },

  /**
   * 按对象 ID 批量加载对象 JSON
   * @param {string} rootPath - 白板根目录路径
   * @param {number[]} objectIds - 对象 ID 数组
   * @returns {Promise<object[]>} 对象数组
   */
  loadObjects(rootPath, objectIds) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.LOAD_OBJECTS, {
      rootPath,
      objectIds,
    });
  },

  /**
   * 批量保存对象 JSON（扁平存储，每个对象一个文件）
   * @param {string} rootPath - 白板根目录路径
   * @param {object[]} objects - 对象 plain object 数组，每项必须含 id
   * @returns {Promise<boolean>} 是否成功保存
   */
  saveObjects(rootPath, objects) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.SAVE_OBJECTS, {
      rootPath,
      objects,
    });
  },

  /**
   * 删除指定对象 JSON
   * @param {string} rootPath - 白板根目录路径
   * @param {number} objectId - 对象 id
   * @returns {Promise<boolean>} 是否成功删除
   */
  deleteObject(rootPath, objectId) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.DELETE_OBJECT, {
      rootPath,
      objectId,
    });
  },
};

export { boardFileOperateBridge };
