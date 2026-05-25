/**
 * @file Core 文件操作渲染器桥接
 * @description 提供渲染进程向预加载层调用 Core 文件操作的桥接接口。
 * @module core/bridges/file-operate-bridge-renderer
 * @author Zhou Chenyu
 */

import { CORE_FILE_OPERATE_ACTIONS } from "./file-operate-bridge-common.js";

/**
 * 获取预加载层注入的 Core 文件操作桥。
 * @returns {{call: function({action: string, payload: any}): Promise<any>}}
 */
function getCoreFileOperateBridge() {
  const bridge = globalThis.__houndCoreFileOps;
  if (!bridge || typeof bridge.call !== "function") {
    throw new Error(
      "Core file operate bridge is unavailable. Did preload-io.js load?",
    );
  }
  return bridge;
}

/**
 * 调用 Core 文件操作 IPC。
 * @param {string} action - 动作名
 * @param {any} payload - 动作参数
 * @returns {Promise<any>}
 */
async function callCoreFileOperate(action, payload) {
  return getCoreFileOperateBridge().call({ action, payload });
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
   * 加载指定区块的层叠图
   * @param {string} rootPath - 白板根目录路径
   * @param {number} chunkId - 区块 id
   * @returns {Promise<any>} 层叠图数据
   */
  loadTierGraph(rootPath, chunkId) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.LOAD_TIER_GRAPH, {
      rootPath,
      chunkId,
    });
  },

  /**
   * 保存指定区块的层叠图
   * @param {string} rootPath - 白板根目录路径
   * @param {number} chunkId - 区块 id
   * @param {any[]} graphData - 层叠图数据
   * @returns {Promise<boolean>} 是否成功保存
   */
  saveTierGraph(rootPath, chunkId, graphData) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.SAVE_TIER_GRAPH, {
      rootPath,
      chunkId,
      graphData,
    });
  },

  /**
   * 加载指定区块的对象覆盖区块索引
   * @param {string} rootPath - 白板根目录路径
   * @param {number} chunkId - 区块 id
   * @returns {Promise<any[]>} 覆盖索引数据
   */
  loadChunkObjectCoverIndex(rootPath, chunkId) {
    return callCoreFileOperate(
      CORE_FILE_OPERATE_ACTIONS.LOAD_CHUNK_OBJECT_COVER_INDEX,
      {
        rootPath,
        chunkId,
      },
    );
  },

  /**
   * 保存指定区块的对象覆盖区块索引
   * @param {string} rootPath - 白板根目录路径
   * @param {number} chunkId - 区块 id
   * @param {any[]} coverIndexData - 覆盖索引数据
   * @returns {Promise<boolean>} 是否成功保存
   */
  saveChunkObjectCoverIndex(rootPath, chunkId, coverIndexData) {
    return callCoreFileOperate(
      CORE_FILE_OPERATE_ACTIONS.SAVE_CHUNK_OBJECT_COVER_INDEX,
      {
        rootPath,
        chunkId,
        coverIndexData,
      },
    );
  },

  /**
   * 加载指定区块的所有对象 JSON
   * @param {string} rootPath - 白板根目录路径
   * @param {number} chunkId - 区块 id
   * @returns {Promise<object[]>} 对象数组
   */
  loadChunkObjects(rootPath, chunkId) {
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.LOAD_CHUNK_OBJECTS, {
      rootPath,
      chunkId,
    });
  },

  /**
   * 保存指定区块的所有对象 JSON
   * @param {string} rootPath - 白板根目录路径
   * @param {number} chunkId - 区块 id
   * @param {object[]} objects - 对象数组
   * @returns {Promise<boolean>} 是否成功保存
   */
  saveChunkObjects(rootPath, chunkId, objects) {
    // 此处要求 objects 是可序列化的 plain object 数组。
    return callCoreFileOperate(CORE_FILE_OPERATE_ACTIONS.SAVE_CHUNK_OBJECTS, {
      rootPath,
      chunkId,
      objects,
    });
  },
};

export { boardFileOperateBridge };
