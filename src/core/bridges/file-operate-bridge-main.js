/**
 * @file Core 文件操作主桥接
 * @description 处理白板根目录与文件系统相关的核心 IPC 交互。
 * @module core/bridges/file-operate-bridge-main
 * @author Zhou Chenyu
 */

import { Directory } from "../../utils/filesys/io.js";
import {
  CORE_FILE_OPERATE_ACTIONS,
  CORE_FILE_OPERATE_CHANNEL,
} from "./file-operate-bridge-common.js";

/**
 * 解析并校验白板根目录
 * @param {string} rootPath - 白板根目录绝对路径
 * @returns {Directory}
 */
function getRootDirectory(rootPath) {
  if (typeof rootPath !== "string" || rootPath.trim() === "") {
    throw new Error("Invalid board root path.");
  }
  return Directory.parse(rootPath);
}

/**
 * 创建白板根目录及基础文件结构
 * @param {{rootPath: string, boardMeta: object, config: object}} payload - 请求参数
 * @returns {boolean}
 */
function handleCreateBoardRoot(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const boardMeta = payload?.boardMeta;
  const config = payload?.config;

  if (!boardMeta || !config) {
    throw new Error("Invalid create board payload.");
  }

  directory.rmWhenExist().make();
  directory.peek("meta", "json").writeJSON(boardMeta);
  directory.peek("config", "json").writeJSON(config);
  directory.cd("devices").make();
  directory.cd("history").make();
  directory.cd("objects").make();
  directory.cd("chunks").make();
  directory.cd("templates").make();

  return true;
}

/**
 * 创建指定区块的文件存储目录
 * @param {{rootPath: string, chunkId: number}} payload - 请求参数
 * @returns {boolean}
 */
function handleCreateChunkStorage(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const chunkId = payload?.chunkId;
  if (!Number.isInteger(chunkId)) {
    throw new Error("Invalid chunk id.");
  }

  directory.cd("chunks").cd(chunkId.toString()).rmWhenExist().make();

  return true;
}

/**
 * 写入区块连接信息
 * @param {{rootPath: string, connection: {count:number, order:number[], size:number}}} payload - 请求参数
 * @returns {boolean}
 */
function handleWriteChunkConnection(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const connection = payload?.connection;
  if (!connection || !Array.isArray(connection.order)) {
    throw new Error("Invalid chunk connection payload.");
  }

  directory.cd("chunks").peek("connection", "json").writeJSON(connection);
  return true;
}

/**
 * 写入白板打开轨迹
 * @param {{rootPath: string, trace: {onChunk:number, offset:number}}} payload - 请求参数
 * @returns {boolean}
 */
function handleWriteTrace(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const trace = payload?.trace;
  if (!trace) {
    throw new Error("Invalid trace payload.");
  }

  directory.peek("trace", "json").writeJSON(trace);
  return true;
}

/**
 * 读取白板快照（meta/config/connection/trace）
 * @param {{rootPath: string, expectedBoardMeta?: {type?:string}}} payload - 请求参数
 * @returns {{meta: object, config: object, connection: object, trace: object}}
 */
function handleLoadBoardSnapshot(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const expectedBoardMeta = payload?.expectedBoardMeta;

  const metaFile = directory.peek("meta", "json");
  if (!metaFile.exist()) {
    throw new Error("Not a board file.");
  }
  const meta = metaFile.catJSON();
  if (expectedBoardMeta && meta.type !== expectedBoardMeta.type) {
    throw new Error("Not a board file.");
  }

  const configFile = directory.peek("config", "json");
  if (!configFile.exist()) {
    throw new Error("Corrupted board file.");
  }
  const config = configFile.catJSON();

  const connectionFile = directory.cd("chunks").peek("connection", "json");
  if (!connectionFile.exist()) {
    throw new Error("Corrupted board file.");
  }
  const connection = connectionFile.catJSON();

  const traceFile = directory.peek("trace", "json");
  let trace;
  if (!traceFile.exist()) {
    trace = {
      onChunk: connection.order?.[0],
      offset: 0,
    };
  } else {
    trace = traceFile.catJSON();
    if (!trace.onChunk) {
      trace.onChunk = connection.order?.[0];
    }
    if (trace.offset === undefined) {
      trace.offset = 0;
    }
  }

  return {
    meta,
    config,
    connection,
    trace,
  };
}

/**
 * 读取指定区块的元数据（层叠图 + 覆盖索引）
 * @param {{rootPath: string, chunkId: number}} payload - 请求参数
 * @returns {{ tierGraph: any[], objectCoverIndex: any[] }}
 */
function handleLoadChunkMetadata(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const chunkId = payload?.chunkId;
  if (!Number.isInteger(chunkId)) {
    throw new Error("Invalid chunk id.");
  }

  const metadataFile = directory.cd("chunks").peek(chunkId.toString(), "json");
  if (!metadataFile.exist()) {
    return { tierGraph: [], objectCoverIndex: [] };
  }

  const data = metadataFile.catJSON();
  return {
    tierGraph: Array.isArray(data?.tierGraph) ? data.tierGraph : data,
    objectCoverIndex: Array.isArray(data?.objectCoverIndex)
      ? data.objectCoverIndex
      : [],
  };
}

/**
 * 保存指定区块的元数据（层叠图 + 覆盖索引）
 * @param {{rootPath: string, chunkId: number, tierGraph: any[], objectCoverIndex: any[]}} payload - 请求参数
 * @returns {boolean}
 */
function handleSaveChunkMetadata(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const chunkId = payload?.chunkId;
  const tierGraph = payload?.tierGraph;
  const objectCoverIndex = payload?.objectCoverIndex;
  if (!Number.isInteger(chunkId) || !Array.isArray(tierGraph)) {
    throw new Error("Invalid save chunk metadata payload.");
  }

  directory
    .cd("chunks")
    .peek(chunkId.toString(), "json")
    .rmWhenExist()
    .init()
    .writeJSON({
      tierGraph,
      objectCoverIndex: Array.isArray(objectCoverIndex)
        ? objectCoverIndex
        : [],
    });

  return true;
}

/**
 * 按对象 ID 批量读取对象 JSON
 * @param {{rootPath: string, objectIds: number[]}} payload - 请求参数
 * @returns {object[]}
 */
function handleLoadObjects(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const objectIds = payload?.objectIds;
  if (!Array.isArray(objectIds)) {
    throw new Error("Invalid load objects payload.");
  }

  const objectsDir = directory.cd("objects");
  return objectIds
    .filter((id) => Number.isInteger(id))
    .map((id) => {
      const file = objectsDir.peek(id.toString(), "json");
      return file.exist() ? file.catJSON() : null;
    })
    .filter(Boolean);
}

/**
 * 批量保存对象 JSON（扁平存储，每个对象一个文件）
 * @param {{rootPath: string, objects: object[]}} payload - 请求参数
 * @returns {boolean}
 */
function handleSaveObjects(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const objects = payload?.objects;
  if (!Array.isArray(objects)) {
    throw new Error("Invalid save objects payload.");
  }

  const objectsDir = directory.cd("objects");
  objectsDir.existOrMake();

  for (const objectData of objects) {
    const objectId = objectData?.id;
    if (!Number.isInteger(objectId)) continue;
    objectsDir.peek(objectId.toString(), "json").writeJSON(objectData);
  }

  return true;
}

/**
 * 删除指定对象 JSON
 * @param {{rootPath: string, objectId: number}} payload - 请求参数
 * @returns {boolean}
 */
function handleDeleteObject(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const objectId = payload?.objectId;
  if (!Number.isInteger(objectId)) {
    throw new Error("Invalid delete object payload.");
  }

  const file = directory.cd("objects").peek(objectId.toString(), "json");
  if (file.exist()) {
    file.rmWhenExist();
    return true;
  }
  return false;
}

/**
 * Core 文件操作请求分发器
 * @param {import("electron").IpcMainInvokeEvent | null} _event - IPC 事件对象
 * @param {{action: string, payload: any}} request - 请求体
 * @returns {any}
 */
function handleCoreFileOperateRequest(_event, request) {
  const action = request?.action;
  const payload = request?.payload;

  switch (action) {
    case CORE_FILE_OPERATE_ACTIONS.CREATE_BOARD_ROOT:
      return handleCreateBoardRoot(payload);
    case CORE_FILE_OPERATE_ACTIONS.CREATE_CHUNK_STORAGE:
      return handleCreateChunkStorage(payload);
    case CORE_FILE_OPERATE_ACTIONS.WRITE_CHUNK_CONNECTION:
      return handleWriteChunkConnection(payload);
    case CORE_FILE_OPERATE_ACTIONS.WRITE_TRACE:
      return handleWriteTrace(payload);
    case CORE_FILE_OPERATE_ACTIONS.LOAD_BOARD_SNAPSHOT:
      return handleLoadBoardSnapshot(payload);
    case CORE_FILE_OPERATE_ACTIONS.LOAD_CHUNK_METADATA:
      return handleLoadChunkMetadata(payload);
    case CORE_FILE_OPERATE_ACTIONS.SAVE_CHUNK_METADATA:
      return handleSaveChunkMetadata(payload);
    case CORE_FILE_OPERATE_ACTIONS.LOAD_OBJECTS:
      return handleLoadObjects(payload);
    case CORE_FILE_OPERATE_ACTIONS.SAVE_OBJECTS:
      return handleSaveObjects(payload);
    case CORE_FILE_OPERATE_ACTIONS.DELETE_OBJECT:
      return handleDeleteObject(payload);
    default:
      throw new Error(`Unsupported core file operate action: ${action}`);
  }
}

/**
 * 注册 Core 文件操作 IPC 桥接
 * @param {import("electron").IpcMain} ipcMain - Electron ipcMain 实例
 */
function registerCoreFileOperateBridge(ipcMain) {
  ipcMain.handle(CORE_FILE_OPERATE_CHANNEL, handleCoreFileOperateRequest);
}

export { handleCoreFileOperateRequest, registerCoreFileOperateBridge };
