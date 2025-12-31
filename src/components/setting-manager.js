/**
 * @file 设置管理模块
 * @module setting-manager
 * @description 功能:
 * - 应用设置持久化
 * - 文件操作对话框 (打开/保存)
 * - 设置变更通知
 */

const { Directory } = require('../utils/io');

let userDataDir, settingsFile;
const defaultSettings = { theme: 'light', language: 'zh-CN' };

/**
 * 初始化设置管理器
 * @function init
 * @param {Object} app - Electron 应用对象
 */
function init(app) {
  userDataDir = Directory.parse(app.getPath('userData'));
  settingsFile = userDataDir.cd("data").existOrMake().peek('settings', 'json').existOrWriteJSON(defaultSettings);
}

/**
 * 从文件加载设置
 * @function loadSettings
 * @returns {Object} 设置对象
 */
function loadSettings() {
  return settingsFile.existOrWriteJSON(defaultSettings).catJSON();
}

/**
 * 保存设置到文件
 * @function saveSettings
 * @param {Object} settings - 要保存的设置对象
 * @param {string} settings.theme - 当前主题
 * @param {string} settings.language - 当前语言
 */
function saveSettings(settings) {
  try {
    settingsFile.writeJSON(settings);
  } catch (err) {
    console.error('保存设置时出错:', err);
  }
}

/**
 * 设置与设置相关的IPC处理器
 * @function setupSettingsIPC
 * @param {Object} ipc - IPC主进程对象
 * @param {Object} BrowserWindow - BrowserWindow类
 */
function setupSettingsIPC(ipc, BrowserWindow) {
  /**
   * 获取当前设置的IPC处理器
   * @event get-current-settings
   * @listens ipc#get-current-settings
   */
  ipc.handle('get-current-settings', async () => {
    return loadSettings();
  });

  /**
   * 设置变更的IPC处理器
   * @event settings-changed
   * @listens ipc#settings-changed
   */
  ipc.on('settings-changed', (event, settings) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('settings-changed', settings);
    });
    saveSettings(settings);
  });
}

module.exports = {
  init,
  loadSettings,
  saveSettings,
  setupSettingsIPC,
};
