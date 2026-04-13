import { Directory, File } from "./utils/filesys/io.js";
import {
  IO_BRIDGE_BATCH_CHANNEL,
  IO_BRIDGE_CHANNEL,
} from "./io-bridge-common.js";

/**
 * 允许通过 IPC 调用的 Directory 方法集合。
 * @type {Set<string>}
 */
const DIRECTORY_METHODS = new Set([
  "exist",
  "existDir",
  "existFile",
  "make",
  "existOrMake",
  "cp",
  "rm",
  "rmWhenExist",
  "mv",
  "ls",
  "lsDir",
  "lsFile",
  "hide",
  "unhide",
  "compress",
]);

/**
 * 允许通过 IPC 调用的 File 方法集合。
 * @type {Set<string>}
 */
const FILE_METHODS = new Set([
  "cat",
  "catJSON",
  "write",
  "writeJSON",
  "exist",
  "init",
  "existOrInit",
  "existOrWrite",
  "existOrWriteJSON",
  "cp",
  "mv",
  "rm",
  "rmWhenExist",
  "hide",
  "unhide",
  "extract",
]);

/**
 * 将主进程中的 Directory/File 实例序列化为可通过 IPC 传输的数据。
 * @param {any} value - 任意待序列化值
 * @returns {any} 可序列化值
 */
function serializeIOValue(value) {
  if (value instanceof Directory) {
    return {
      __houndType: "Directory",
      paths: [...value.paths],
    };
  }

  if (value instanceof File) {
    return {
      __houndType: "File",
      dir: serializeIOValue(value.dir),
      name: value.name,
      extension: value.extension,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeIOValue(item));
  }

  return value;
}

/**
 * 将 IPC 传入的序列化值恢复为 Directory/File 实例或普通值。
 * @param {any} value - 待反序列化值
 * @returns {any} 反序列化后的值
 */
function deserializeIOValue(value) {
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => deserializeIOValue(item));
  }

  if (value.__houndType === "Directory") {
    return new Directory(value.paths);
  }

  if (value.__houndType === "File") {
    return new File(
      deserializeIOValue(value.dir),
      value.name,
      value.extension,
    );
  }

  return value;
}

/**
 * 判断某个实例方法是否允许通过 I/O 桥接调用。
 * @param {Directory|File} target - 目标实例
 * @param {string} method - 方法名
 * @returns {boolean} 是否允许调用
 */
function isAllowedMethod(target, method) {
  if (target instanceof Directory) return DIRECTORY_METHODS.has(method);
  if (target instanceof File) return FILE_METHODS.has(method);
  return false;
}

/**
 * 处理来自渲染进程的 I/O 请求。
 * @param {import("electron").IpcMainInvokeEvent | null} _event - IPC 事件对象
 * @param {{ target: any, method: string, args?: any[] }} request - I/O 请求体
 * @returns {any} 序列化后的返回结果
 * @throws {Error} 当请求不合法或方法未被允许时抛出错误
 */
function handleIOBridgeRequest(_event, request) {
  const target = deserializeIOValue(request?.target);
  const method = request?.method;
  const args = deserializeIOValue(request?.args ?? []);

  if (!target || typeof method !== "string") {
    throw new Error("Invalid io bridge request.");
  }

  if (!isAllowedMethod(target, method)) {
    throw new Error(`Unsupported io bridge method: ${method}`);
  }

  const result = target[method](...args);
  return serializeIOValue(result);
}

/**
 * 顺序处理来自渲染进程的 I/O 批处理请求。
 * @param {import("electron").IpcMainInvokeEvent | null} _event - IPC 事件对象
 * @param {{ target: any, operations?: Array<{ method: string, args?: any[] }> }} request - I/O 批处理请求体
 * @returns {{ results: any[], target: any }} 序列化后的批处理结果与最终目标状态
 * @throws {Error} 当请求不合法或方法未被允许时抛出错误
 */
function handleIOBridgeBatchRequest(_event, request) {
  const target = deserializeIOValue(request?.target);
  const operations = request?.operations ?? [];

  if (!target || !Array.isArray(operations)) {
    throw new Error("Invalid io bridge batch request.");
  }

  const results = operations.map((operation) => {
    if (!operation || typeof operation.method !== "string") {
      throw new Error("Invalid io bridge batch operation.");
    }

    if (!isAllowedMethod(target, operation.method)) {
      throw new Error(`Unsupported io bridge method: ${operation.method}`);
    }

    const args = deserializeIOValue(operation.args ?? []);
    return serializeIOValue(target[operation.method](...args));
  });

  return {
    results,
    target: serializeIOValue(target),
  };
}

/**
 * 在主进程注册 I/O IPC handler。
 * @param {import("electron").IpcMain} ipcMain - Electron 主进程 ipcMain 实例
 */
function registerIOBridge(ipcMain) {
  ipcMain.handle(IO_BRIDGE_CHANNEL, handleIOBridgeRequest);
  ipcMain.handle(IO_BRIDGE_BATCH_CHANNEL, handleIOBridgeBatchRequest);
}

export {
  IO_BRIDGE_BATCH_CHANNEL,
  IO_BRIDGE_CHANNEL,
  handleIOBridgeBatchRequest,
  handleIOBridgeRequest,
  registerIOBridge,
};