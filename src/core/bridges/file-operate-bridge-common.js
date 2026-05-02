/**
 * Core 组件文件操作专用 IPC 通道。
 * @type {string}
 */
const CORE_FILE_OPERATE_CHANNEL = "houndwhiteboard:core-file-operate";

/**
 * Core 组件文件操作动作枚举。
 * @type {{
 *   CREATE_BOARD_ROOT: string,
 *   CREATE_PAGE_STORAGE: string,
 *   WRITE_PAGE_CONNECTION: string,
 *   WRITE_TRACE: string,
 *   LOAD_BOARD_SNAPSHOT: string,
 *   LOAD_TIER_GRAPH: string,
 *   SAVE_TIER_GRAPH: string,
 *   LOAD_PAGE_OBJECTS: string,
 *   SAVE_PAGE_OBJECTS: string,
 * }}
 */
const CORE_FILE_OPERATE_ACTIONS = {
  CREATE_BOARD_ROOT: "create-board-root",
  CREATE_PAGE_STORAGE: "create-page-storage",
  WRITE_PAGE_CONNECTION: "write-page-connection",
  WRITE_TRACE: "write-trace",
  LOAD_BOARD_SNAPSHOT: "load-board-snapshot",
  LOAD_TIER_GRAPH: "load-tier-graph",
  SAVE_TIER_GRAPH: "save-tier-graph",
  LOAD_PAGE_OBJECTS: "load-page-objects",
  SAVE_PAGE_OBJECTS: "save-page-objects",
};

export {
  CORE_FILE_OPERATE_ACTIONS,
  CORE_FILE_OPERATE_CHANNEL,
};
