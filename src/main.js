/**
 * # 主进程（React支持）
 * ## 功能
 * - 传递文件IO副作用
 * - 窗口管理
 * - 程序坞
 * ## 特征
 * - 单例应用模式
 * - 多窗口实例，共享进程
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const url = require("url");
import fs from "fs";
import registerHandlers from "./utils/safe-io/ipc/handlers.js";
import startGC from "./utils/safe-io/auth/registry.js";
const { electron } = require("process");

/**
 * ### 窗口类
 * 窗口对象和窗口状态
 * #### 窗口状态
 * - 无文件窗口
 * - 绑定文件窗口
 * - 全屏窗口
 **/
class Window {
  constructor(config) {
    this.isBindFile = config.isBindFile;
    this.isFullScreen = config.isFullScreen;
    if (this.isBindFile) {
      this.bindFile = config.bindFile;
    }
    // 创建浏览器窗口
    this.win = new BrowserWindow({
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
        preload: path.join(__dirname, 'preload.js'),
      },
      icon: path.join(
        __dirname,
        "../data/themes/icons/HoundWhiteboard/assets/add.svg",
      ),
      title: "Hound Whiteboard",
    });

    // 加载应用界面
    // 使用 file:// 协议加载本地文件
    const startUrl = url.format({
      pathname: path.join(__dirname, "ui", "index.html"),
      protocol: "file:",
      slashes: true,
    });

    this.win.loadURL(startUrl);

    this.win.once("ready-to-show", () => {
      // 显示窗口（避免白屏）
      this.win.show();
      // 打开开发者工具（开发时使用）
      // this.win.webContents.openDevTools();
    });

    // 窗口关闭时触发
    this.win.on("closed", () => {
      this.win = null;
    });
  }
}

// 声明窗口列表
let windows = [];

// IPC: 配置变更广播
ipcMain.on('config-changed', (event, data) => {
  // 广播到所有窗口（除了发送者）
  windows.forEach(window => {
    if (window.win && window.win.webContents && window.win.webContents !== event.sender) {
      window.win.webContents.send('config-updated', data);
    }
  });
});

app.whenReady().then(() => {

  // =========================
  // 🔐 SAFE-IO BOOTSTRAP
  // =========================

  // 1. 注册 IPC handlers（核心）
  registerHandlers();

  // 2. 启动 GC（capability cleanup）
  startGC();

  // 注册允许访问的根目录（示例）
  // registerRoot("/Users/your-app/data");
  // registerRoot("/Users/your-app/workspace");

  // 3. 获取 data 目录 (应用安装目录中存在的 data 目录?? AppData/Roaming/HoundWhiteboard/data)
  const installDir = app.getPath("exe") ?? electron.getAppPath();
  const appDataDir = app.getPath("appData") ?? electron.getAppDataPath();
  const dataDir = fs.existsSync(path.join(installDir, "data"))
                    ? path.join(installDir, "data")
                    : path.join(appDataDir, "HoundWhiteboard", "data");
  
  // 4. 注册 data 目录
  registerRoot(dataDir);

  // =========================

  // 检查是否有另一个应用实例在运行
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  // 创建窗口
  createWindow({
    isBindFile: false,
    isFullScreen: false,
  });
  // 当另一个实例试图启动应用程序时，执行此回调
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    createWindow({
      isBindFile: false,
      isFullScreen: false,
    });
  });
});

function createWindow(config) {
  windows.push(new Window(config));
}
