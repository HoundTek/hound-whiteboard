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
  directory.cd("objects").cd(`chunk${chunkId.toString()}`).rmWhenExist().make();

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
 * 读取指定区块的层叠图文件
 * @param {{rootPath: string, chunkId: number}} payload - 请求参数
 * @returns {any}
 */
function handleLoadTierGraph(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const chunkId = payload?.chunkId;
  if (!Number.isInteger(chunkId)) {
    throw new Error("Invalid chunk id.");
  }

  const tierGraphFile = directory.cd("chunks").peek(chunkId.toString(), "json");
  if (!tierGraphFile.exist()) {
    throw new Error(`file ${tierGraphFile.getPath()} does not exist.`);
  }

  return tierGraphFile.catJSON();
}

/**
 * 保存指定区块的层叠图文件
 * @param {{rootPath: string, chunkId: number, graphData: any[]}} payload - 请求参数
 * @returns {boolean}
 */
function handleSaveTierGraph(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const chunkId = payload?.chunkId;
  const graphData = payload?.graphData;
  if (!Number.isInteger(chunkId) || !Array.isArray(graphData)) {
    throw new Error("Invalid save tier graph payload.");
  }

  directory
    .cd("chunks")
    .peek(chunkId.toString(), "json")
    .rmWhenExist()
    .init()
    .write(JSON.stringify(graphData));

  return true;
}

/**
 * 解析对象覆盖区块索引文件位置
 * @param {Directory} directory - 白板根目录
 * @param {number} chunkId - 区块 id
 * @returns {File}
 */
function resolveChunkObjectCoverIndexFile(directory, chunkId) {
  return directory
    .cd("chunks")
    .peek(`${chunkId.toString()}-object-cover`, "json");
}

/**
 * 读取指定区块的对象覆盖区块索引
 * @param {{rootPath: string, chunkId: number}} payload - 请求参数
 * @returns {any[]}
 */
function handleLoadChunkObjectCoverIndex(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const chunkId = payload?.chunkId;
  if (!Number.isInteger(chunkId)) {
    throw new Error("Invalid chunk id.");
  }

  const coverIndexFile = resolveChunkObjectCoverIndexFile(directory, chunkId);
  if (!coverIndexFile.exist()) {
    return [];
  }

  return coverIndexFile.catJSON();
}

/**
 * 保存指定区块的对象覆盖区块索引
 * @param {{rootPath: string, chunkId: number, coverIndexData: any[]}} payload - 请求参数
 * @returns {boolean}
 */
function handleSaveChunkObjectCoverIndex(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const chunkId = payload?.chunkId;
  const coverIndexData = payload?.coverIndexData;
  if (!Number.isInteger(chunkId) || !Array.isArray(coverIndexData)) {
    throw new Error("Invalid save chunk object cover index payload.");
  }

  resolveChunkObjectCoverIndexFile(directory, chunkId)
    .rmWhenExist()
    .init()
    .write(JSON.stringify(coverIndexData));

  return true;
}

/**
 * 读取指定区块所有对象 JSON
 * @param {{rootPath: string, chunkId: number}} payload - 请求参数
 * @returns {object[]}
 */
function handleLoadChunkObjects(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const chunkId = payload?.chunkId;
  if (!Number.isInteger(chunkId)) {
    throw new Error("Invalid chunk id.");
  }

  const objectsDir = directory.cd("objects").cd(`chunk${chunkId.toString()}`);
  if (!objectsDir.exist()) {
    return [];
  }

  return objectsDir
    .lsFile()
    .filter((file) => file.extension === "json")
    .map((file) => file.catJSON());
}

/**
 * 保存指定区块全部对象 JSON
 * @description
 * 保存时会先删除该区块目录下已有的 json 文件，再按对象 id 写入，
 * 以确保磁盘状态和内存态一致。
 * @param {{rootPath: string, chunkId: number, objects: object[]}} payload - 请求参数
 * @returns {boolean}
 */
function handleSaveChunkObjects(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const chunkId = payload?.chunkId;
  const objects = payload?.objects;
  if (!Number.isInteger(chunkId) || !Array.isArray(objects)) {
    throw new Error("Invalid save chunk objects payload.");
  }

  const objectsDir = directory.cd("objects").cd(`chunk${chunkId.toString()}`);
  objectsDir.existOrMake();

  // 先清理旧的对象文件，避免遗留脏数据
  for (const file of objectsDir.lsFile()) {
    if (file.extension === "json") {
      file.rmWhenExist();
    }
  }

  // 按对象 id 写入，若缺失 id 则按顺序生成兜底文件名
  objects.forEach((objectData, index) => {
    const fileName = Number.isInteger(objectData?.id)
      ? objectData.id.toString()
      : `object-${index.toString()}`;
    objectsDir.peek(fileName, "json").writeJSON(objectData);
  });

  return true;
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
    case CORE_FILE_OPERATE_ACTIONS.LOAD_TIER_GRAPH:
      return handleLoadTierGraph(payload);
    case CORE_FILE_OPERATE_ACTIONS.SAVE_TIER_GRAPH:
      return handleSaveTierGraph(payload);
    case CORE_FILE_OPERATE_ACTIONS.LOAD_CHUNK_OBJECT_COVER_INDEX:
      return handleLoadChunkObjectCoverIndex(payload);
    case CORE_FILE_OPERATE_ACTIONS.SAVE_CHUNK_OBJECT_COVER_INDEX:
      return handleSaveChunkObjectCoverIndex(payload);
    case CORE_FILE_OPERATE_ACTIONS.LOAD_CHUNK_OBJECTS:
      return handleLoadChunkObjects(payload);
    case CORE_FILE_OPERATE_ACTIONS.SAVE_CHUNK_OBJECTS:
      return handleSaveChunkObjects(payload);
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
