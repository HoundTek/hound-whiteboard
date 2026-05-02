import path from "path";
import { fileURLToPath } from "url";
import { app, BrowserWindow, ipcMain } from "electron";
import { registerIOBridge } from "./io-bridge-main.js";
import { registerCoreFileOperateBridge } from "./core/bridges/file-operate-bridge-main.js";

let window;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.whenReady().then(() => {
  registerIOBridge(ipcMain);
  registerCoreFileOperateBridge(ipcMain);

  window = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, "preload-io.js"),
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true
    },
    fullscreen: false,
    autoHideMenuBar: false,
    frame: true,
    transparent: false
  });

  window.loadFile(path.join(__dirname, "templates/whiteboard.html"));
});

app.on("window-all-closed", () => {
  setTimeout(() => {
    if (BrowserWindow.getAllWindows().length === 0) {
      app.quit();
    }
  }, 1000);
});
