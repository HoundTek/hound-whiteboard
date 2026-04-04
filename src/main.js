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
const { Directory, File } = require("./utils/io");

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
        "../data/themes/icons/hound-whiteboard/assets/add.svg",
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

/**
 * @typedef {Object} FileOperationParams
 * @property {string} [filePath] - 文件路径
 * @property {string} [dirPath] - 目录路径
 * @property {string} [path] - 目标路径
 * @property {string} [content] - 文件内容
 * @property {Object} [content] - JSON内容
 * @property {boolean} [isFile] - 是否为文件
 * @property {string} [source] - 源路径
 * @property {string} [dest] - 目标路径
 */

/**
 * @typedef {Object} FileOperationResult
 * @property {boolean} success - 操作是否成功
 * @property {*} [data] - 返回数据（成功时）
 * @property {string} [error] - 错误信息（失败时）
 */

/**
 * IPC处理器：通用文件操作通道
 * @param {Electron.IpcMainInvokeEvent} event - IPC事件对象
 * @param {Object} request - 请求对象
 * @param {string} request.action - 操作类型
 * @param {FileOperationParams} request.params - 操作参数
 * @returns {Promise<FileOperationResult>} 操作结果
 * 
 * @example
 * // 支持的操作类型：
 * // - readFile: 读取文件内容
 * // - readJSON: 读取JSON文件
 * // - writeFile: 写入文件
 * // - writeJSON: 写入JSON文件
 * // - exist: 检查文件或目录是否存在
 * // - mkdir: 创建目录
 * // - ls: 列出目录内容
 * // - lsDir: 列出子目录
 * // - lsFile: 列出文件
 * // - delete: 删除文件或目录
 * // - copy: 复制文件或目录
 * // - move: 移动文件或目录
 */
ipcMain.handle('file-operation', async (event, { action, params }) => {
  try {
    let result;
    
    switch (action) {
      case 'readFile': {
        const { filePath } = params;
        const file = File.parse(filePath);
        result = { success: true, data: file.cat() };
        break;
      }
      
      case 'readJSON': {
        const { filePath } = params;
        const file = File.parse(filePath);
        result = { success: true, data: file.catJSON() };
        break;
      }
      
      case 'writeFile': {
        const { filePath, content } = params;
        const file = File.parse(filePath);
        file.write(content);
        result = { success: true };
        break;
      }
      
      case 'writeJSON': {
        const { filePath, content } = params;
        const file = File.parse(filePath);
        file.writeJSON(content);
        result = { success: true };
        break;
      }
      
      case 'exist': {
        const { path: targetPath } = params;
        const isFile = params.isFile;
        if (isFile) {
          const file = File.parse(targetPath);
          result = { success: true, data: file.exist() };
        } else {
          const dir = Directory.parse(targetPath);
          result = { success: true, data: dir.exist() };
        }
        break;
      }
      
      case 'mkdir': {
        const { dirPath } = params;
        const dir = Directory.parse(dirPath);
        dir.make();
        result = { success: true };
        break;
      }
      
      case 'ls': {
        const { dirPath } = params;
        const dir = Directory.parse(dirPath);
        result = { success: true, data: dir.ls() };
        break;
      }
      
      case 'lsDir': {
        const { dirPath } = params;
        const dir = Directory.parse(dirPath);
        const dirs = dir.lsDir().map(d => d.getPath());
        result = { success: true, data: dirs };
        break;
      }
      
      case 'lsFile': {
        const { dirPath } = params;
        const dir = Directory.parse(dirPath);
        const files = dir.lsFile().map(f => f.getPath());
        result = { success: true, data: files };
        break;
      }
      
      case 'delete': {
        const { path: targetPath } = params;
        const isFile = params.isFile;
        if (isFile) {
          const file = File.parse(targetPath);
          file.rm();
        } else {
          const dir = Directory.parse(targetPath);
          dir.rm();
        }
        result = { success: true };
        break;
      }
      
      case 'copy': {
        const { source, dest, isFile } = params;
        if (isFile) {
          const sourceFile = File.parse(source);
          const destFile = File.parse(dest);
          sourceFile.cp(destFile);
        } else {
          const sourceDir = Directory.parse(source);
          const destDir = Directory.parse(dest);
          sourceDir.cp(destDir);
        }
        result = { success: true };
        break;
      }
      
      case 'move': {
        const { source, dest, isFile } = params;
        if (isFile) {
          const sourceFile = File.parse(source);
          const destFile = File.parse(dest);
          sourceFile.mv(destFile);
        } else {
          const sourceDir = Directory.parse(source);
          const destDir = Directory.parse(dest);
          sourceDir.mv(destDir);
        }
        result = { success: true };
        break;
      }
      
      default:
        result = { success: false, error: `Unknown action: ${action}` };
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
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
