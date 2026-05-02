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
  directory.cd("pages").make();
  directory.cd("templates").make();

  return true;
}

/**
 * 创建指定页的文件存储目录
 * @param {{rootPath: string, pageId: number}} payload - 请求参数
 * @returns {boolean}
 */
function handleCreatePageStorage(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const pageId = payload?.pageId;
  if (!Number.isInteger(pageId)) {
    throw new Error("Invalid page id.");
  }

  directory.cd("pages").cd(pageId.toString()).rmWhenExist().make();
  directory
    .cd("objects")
    .cd(`page${pageId.toString()}`)
    .rmWhenExist()
    .make();

  return true;
}

/**
 * 写入页连接信息
 * @param {{rootPath: string, connection: {count:number, order:number[], size:number}}} payload - 请求参数
 * @returns {boolean}
 */
function handleWritePageConnection(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const connection = payload?.connection;
  if (!connection || !Array.isArray(connection.order)) {
    throw new Error("Invalid page connection payload.");
  }

  directory.cd("pages").peek("connection", "json").writeJSON(connection);
  return true;
}

/**
 * 写入白板打开轨迹
 * @param {{rootPath: string, trace: {onPage:number, offset:number}}} payload - 请求参数
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

  const connectionFile = directory.cd("pages").peek("connection", "json");
  if (!connectionFile.exist()) {
    throw new Error("Corrupted board file.");
  }
  const connection = connectionFile.catJSON();

  const traceFile = directory.peek("trace", "json");
  let trace;
  if (!traceFile.exist()) {
    trace = {
      onPage: connection.order?.[0],
      offset: 0,
    };
  } else {
    trace = traceFile.catJSON();
    if (!trace.onPage) {
      trace.onPage = connection.order?.[0];
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
 * 读取指定页的层叠图文件
 * @param {{rootPath: string, pageId: number}} payload - 请求参数
 * @returns {any}
 */
function handleLoadTierGraph(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const pageId = payload?.pageId;
  if (!Number.isInteger(pageId)) {
    throw new Error("Invalid page id.");
  }

  const tierGraphFile = directory.cd("pages").peek(pageId.toString(), "json");
  if (!tierGraphFile.exist()) {
    throw new Error(`file ${tierGraphFile.getPath()} does not exist.`);
  }

  return tierGraphFile.catJSON();
}

/**
 * 保存指定页的层叠图文件
 * @param {{rootPath: string, pageId: number, graphData: any[]}} payload - 请求参数
 * @returns {boolean}
 */
function handleSaveTierGraph(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const pageId = payload?.pageId;
  const graphData = payload?.graphData;
  if (!Number.isInteger(pageId) || !Array.isArray(graphData)) {
    throw new Error("Invalid save tier graph payload.");
  }

  directory
    .cd("pages")
    .peek(pageId.toString(), "json")
    .rmWhenExist()
    .init()
    .write(JSON.stringify(graphData));

  return true;
}

/**
 * 读取指定页所有对象 JSON
 * @param {{rootPath: string, pageId: number}} payload - 请求参数
 * @returns {object[]}
 */
function handleLoadPageObjects(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const pageId = payload?.pageId;
  if (!Number.isInteger(pageId)) {
    throw new Error("Invalid page id.");
  }

  const objectsDir = directory.cd("objects").cd(`page${pageId.toString()}`);
  if (!objectsDir.exist()) {
    return [];
  }

  return objectsDir
    .lsFile()
    .filter((file) => file.extension === "json")
    .map((file) => file.catJSON());
}

/**
 * 保存指定页全部对象 JSON
 * @description
 * 保存时会先删除该页目录下已有的 json 文件，再按对象 id 写入，
 * 以确保磁盘状态和内存态一致。
 * @param {{rootPath: string, pageId: number, objects: object[]}} payload - 请求参数
 * @returns {boolean}
 */
function handleSavePageObjects(payload) {
  const directory = getRootDirectory(payload?.rootPath);
  const pageId = payload?.pageId;
  const objects = payload?.objects;
  if (!Number.isInteger(pageId) || !Array.isArray(objects)) {
    throw new Error("Invalid save page objects payload.");
  }

  const objectsDir = directory.cd("objects").cd(`page${pageId.toString()}`);
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
    case CORE_FILE_OPERATE_ACTIONS.CREATE_PAGE_STORAGE:
      return handleCreatePageStorage(payload);
    case CORE_FILE_OPERATE_ACTIONS.WRITE_PAGE_CONNECTION:
      return handleWritePageConnection(payload);
    case CORE_FILE_OPERATE_ACTIONS.WRITE_TRACE:
      return handleWriteTrace(payload);
    case CORE_FILE_OPERATE_ACTIONS.LOAD_BOARD_SNAPSHOT:
      return handleLoadBoardSnapshot(payload);
    case CORE_FILE_OPERATE_ACTIONS.LOAD_TIER_GRAPH:
      return handleLoadTierGraph(payload);
    case CORE_FILE_OPERATE_ACTIONS.SAVE_TIER_GRAPH:
      return handleSaveTierGraph(payload);
    case CORE_FILE_OPERATE_ACTIONS.LOAD_PAGE_OBJECTS:
      return handleLoadPageObjects(payload);
    case CORE_FILE_OPERATE_ACTIONS.SAVE_PAGE_OBJECTS:
      return handleSavePageObjects(payload);
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

export {
  handleCoreFileOperateRequest,
  registerCoreFileOperateBridge,
};
