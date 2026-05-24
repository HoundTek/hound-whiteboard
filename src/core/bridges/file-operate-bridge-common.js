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
 *   LOAD_TIER_GRAPH: string,
 *   SAVE_TIER_GRAPH: string,
 *   LOAD_CHUNK_OBJECT_COVER_INDEX: string,
 *   SAVE_CHUNK_OBJECT_COVER_INDEX: string,
 *   LOAD_CHUNK_OBJECTS: string,
 *   SAVE_CHUNK_OBJECTS: string,
 * }}
 */
const CORE_FILE_OPERATE_ACTIONS = {
  CREATE_BOARD_ROOT: "create-board-root",
  CREATE_CHUNK_STORAGE: "create-chunk-storage",
  WRITE_CHUNK_CONNECTION: "write-chunk-connection",
  WRITE_TRACE: "write-trace",
  LOAD_BOARD_SNAPSHOT: "load-board-snapshot",
  LOAD_TIER_GRAPH: "load-tier-graph",
  SAVE_TIER_GRAPH: "save-tier-graph",
  LOAD_CHUNK_OBJECT_COVER_INDEX: "load-chunk-object-cover-index",
  SAVE_CHUNK_OBJECT_COVER_INDEX: "save-chunk-object-cover-index",
  LOAD_CHUNK_OBJECTS: "load-chunk-objects",
  SAVE_CHUNK_OBJECTS: "save-chunk-objects",
};

export { CORE_FILE_OPERATE_ACTIONS, CORE_FILE_OPERATE_CHANNEL };
