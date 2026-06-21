/**
 * @file Core 文件操作桥接通道定义
 * @description 定义 Core 文件操作 IPC 通道与动作枚举。
 * @module core/bridges/file-operate-bridge-common
 * @author Zhou Chenyu
 */

/**
 * Core 组件文件操作专用 IPC 通道。
 * @type {string}
 */
const CORE_FILE_OPERATE_CHANNEL = "houndwhiteboard:core-file-operate";

/**
 * Core 组件文件操作动作枚举。
 * @type {{
 *   CREATE_BOARD_ROOT: string,
 *   CREATE_CHUNK_STORAGE: string,
 *   WRITE_CHUNK_CONNECTION: string,
 *   WRITE_TRACE: string,
 *   LOAD_BOARD_SNAPSHOT: string,
 *   LOAD_CHUNK_METADATA: string,
 *   SAVE_CHUNK_METADATA: string,
 *   LOAD_OBJECTS: string,
 *   SAVE_OBJECTS: string,
 *   DELETE_OBJECT: string,
 * }}
 */
const CORE_FILE_OPERATE_ACTIONS = {
  CREATE_BOARD_ROOT: "create-board-root",
  CREATE_CHUNK_STORAGE: "create-chunk-storage",
  WRITE_CHUNK_CONNECTION: "write-chunk-connection",
  WRITE_TRACE: "write-trace",
  LOAD_BOARD_SNAPSHOT: "load-board-snapshot",
  LOAD_CHUNK_METADATA: "load-chunk-metadata",
  SAVE_CHUNK_METADATA: "save-chunk-metadata",
  LOAD_OBJECTS: "load-objects",
  SAVE_OBJECTS: "save-objects",
  DELETE_OBJECT: "delete-object",
};

export { CORE_FILE_OPERATE_ACTIONS, CORE_FILE_OPERATE_CHANNEL };
