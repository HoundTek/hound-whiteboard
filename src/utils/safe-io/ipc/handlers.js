/**
 * @fileoverview IPC Handlers - 窗口与存储目录管理
 * @module safe-io/ipc/handlers
 */

import electron from "electron";

const { ipcMain } = electron;

/** @type {import('../security/manager.js').WindowManager|null} */
let windowManagerRef = null;

/**
 * 设置 WindowManager 实例
 * @param {import('../security/manager.js').WindowManager} wm - 窗口管理器实例
 */
export const setWindowManager = (wm) => {
  windowManagerRef = wm;
};

/**
 * 注册所有 IPC handlers
 */
export const registerHandlers = () => {
  ipcMain.handle("window:create", (_, config) => {
    return windowManagerRef?.createWindow(config);
  });

  ipcMain.handle("window:close", (_, windowId) => {
    const window = windowManagerRef?.getWindow(windowId);
    if (window?.win) {
      window.win.close();
      return true;
    }
    return false;
  });

  ipcMain.handle("storage:get-directories", () => {
    return {
      saves: global.SECURE_DIRS?.SAVE_DATA || "unknown",
      plugins: global.SECURE_DIRS?.PLUGINS || "unknown",
      resources: global.SECURE_DIRS?.RESOURCE_PACKS || "unknown",
    };
  });
};