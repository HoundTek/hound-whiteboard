/**
 * # 主进程（安全架构重构版）
 * ## 核心功能
 * - 安全文件IO（存档、插件、资源包）
 * - 窗口级权限隔离
 * - 动态preload生成
 * - 多窗口实例管理
 * ## 安全特性
 * - 单例应用模式
 * - 进程间隔离
 * - Capability-based安全模型
 * - 自动资源清理
 */

import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { format as urlFormat } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==============================
// 🔐 安全模块导入
// ==============================
import { registerHandlers, setWindowManager } from "./utils/safe-io/ipc/handlers.js";
import { startGC, register, revoke } from "./utils/safe-io/auth/registry.js";
import { registerRoot, authorize, getAuthorizedRoots } from "./utils/safe-io/auth/authorize.js";
import { createTokenWithPreset } from "./utils/safe-io/capability/token.js";
import { SecurityManager } from "./utils/safe-io/security/manager.js";

// ==============================
// 📂 目录结构定义
// ==============================
import { getDirectories, ensureDirectories } from "./utils/safe-io/core/path-detector.js";

let DIRS = null;

// ==============================
// 🖼️ 窗口管理器
// ==============================
class WindowManager {
  constructor() {
    this.windows = new Map();
    this.windowIdCounter = 0;
    this.securityManager = new SecurityManager();
  }

  /**
   * 创建新窗口
   * @param {Object} config - 窗口配置
   * @param {boolean} config.isBindFile - 是否绑定文件
   * @param {boolean} config.isFullScreen - 是否全屏
   * @param {string} [config.bindFile] - 绑定的文件路径
   * @param {string} [config.permissionPreset] - 权限预设
   */
  createWindow(config = {}) {
    console.log("[WindowManager] Creating window with config:", config);
    const windowId = `window-${++this.windowIdCounter}`;

    const securityContext = this.securityManager.createContext({
      windowId,
      preset: config.permissionPreset || "READ_ONLY",
      bindFile: config.bindFile,
    });
    console.log("[WindowManager] Security context created for window:", windowId);

    const preloadPath = this.securityManager.generatePreload(windowId, securityContext);
    console.log("[WindowManager] Preload path:", preloadPath);

    if (!fs.existsSync(preloadPath)) {
      console.error("[WindowManager] Preload file does not exist:", preloadPath);
    }

    const uiPath = path.join(__dirname, "ui", "index.html");
    console.log("[WindowManager] UI path:", uiPath);
    console.log("[WindowManager] UI file exists:", fs.existsSync(uiPath));

    const win = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        sandbox: true,
        preload: preloadPath,
        session: session.fromPartition(`persist:${windowId}`),
      },
      title: "Hound Whiteboard",
    });
    console.log("[WindowManager] BrowserWindow created");

    const startUrl = urlFormat({
      pathname: uiPath,
      protocol: "file:",
      slashes: true,
    });
    console.log("[WindowManager] Loading URL:", startUrl);

    win.loadURL(startUrl).then(() => {
      console.log("[WindowManager] URL loaded successfully");
    }).catch((err) => {
      console.error("[WindowManager] Failed to load URL:", err);
    });

    win.once("ready-to-show", () => {
      console.log("[WindowManager] Window ready to show");
      win.show();
    });

    win.on("closed", () => {
      console.log("[WindowManager] Window closed:", windowId);
      this.securityManager.destroyContext(windowId);
      this.windows.delete(windowId);
      revoke(securityContext.tokenId);
    });

    this.windows.set(windowId, {
      win,
      config,
      securityContext,
    });

    win.webContents.on("did-finish-load", () => {
      win.webContents.send("security:init", {
        token: securityContext.token,
        windowId,
        permissions: securityContext.permissions,
      });
    });

    return windowId;
  }

  /**
   * 获取窗口
   * @param {string} windowId - 窗口ID
   */
  getWindow(windowId) {
    return this.windows.get(windowId);
  }

  /**
   * 广播消息到所有窗口
   * @param {string} channel - 通道名
   * @param {*} data - 数据
   * @param {string} [excludeId] - 排除的窗口ID
   */
  broadcast(channel, data, excludeId = null) {
    this.windows.forEach((entry, id) => {
      if (id !== excludeId && entry.win) {
        entry.win.webContents.send(channel, data);
      }
    });
  }
}

// ==============================
// 🚀 应用启动
// ==============================
let windowManager = null;

// =========================
// 🔒 单例检查
// =========================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.whenReady().then(() => {
  console.log("[Main] App is ready, starting initialization...");

  DIRS = getDirectories();
  ensureDirectories(DIRS);
  console.log("[Main] Directories initialized:", DIRS.APP_ROOT);

  global.SECURE_DIRS = {
    SAVE_DATA: DIRS.SAVE_DATA,
    PLUGINS: DIRS.PLUGINS,
    RESOURCE_PACKS: DIRS.RESOURCE_PACKS,
    CACHE: DIRS.CACHE,
    LOGS: DIRS.LOGS,
    PRELOADS: DIRS.PRELOADS,
  };

  windowManager = new WindowManager();
  setWindowManager(windowManager);
  registerHandlers();

  windowManager.createWindow({
    isBindFile: false,
    isFullScreen: false,
    permissionPreset: "READ_WRITE",
  });
});

// ==============================
// 📡 IPC 事件处理
// ==============================

ipcMain.on("config-changed", (event, data) => {
  const senderId = event.sender?.id?.toString();
  windowManager?.broadcast("config-updated", data, senderId);
});

// ==============================
// 🧹 应用退出清理
// ==============================
app.on("will-quit", () => {
  console.log("[Main] Application quitting...");
});

// 全局实例引用（主进程内部使用）
global.windowManager = windowManager;
