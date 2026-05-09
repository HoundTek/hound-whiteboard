/**
 * # IPC Handlers
 */

import { ipcMain } from "electron";

let windowManagerRef = null;

export const setWindowManager = (wm) => {
  windowManagerRef = wm;
};

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