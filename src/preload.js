/**
 * @file Electron预加载脚本
 * @description 通过contextBridge向渲染进程暴露IPC通信接口，提供安全的进程间通信能力
 * @module preload
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * @typedef {Object} ElectronAPI
 * @property {function(ConfigChangeData): void} sendConfigChange - 发送配置变更到主进程
 * @property {function(function(ConfigUpdateData): void): void} onConfigUpdate - 监听来自主进程的配置更新
 * @property {function(): void} removeConfigUpdateListener - 移除配置更新监听器
 * @property {function(string, Object): Promise<FileOperationResult>} fileOperation - 统一文件操作通道
 */

/**
 * @typedef {Object} ConfigChangeData
 * @property {string} type - 配置类型（theme、iconPack、locale）
 * @property {string} value - 配置值
 */

/**
 * @typedef {Object} ConfigUpdateData
 * @property {string} type - 配置类型
 * @property {string} value - 配置值
 */

/**
 * @typedef {Object} FileOperationResult
 * @property {boolean} success - 操作是否成功
 * @property {*} [data] - 返回数据（成功时）
 * @property {string} [error] - 错误信息（失败时）
 */

/**
 * 暴露给渲染进程的Electron API
 * @type {ElectronAPI}
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 发送配置变更到主进程，广播到其他窗口
   * @param {ConfigChangeData} data - 配置变更数据
   * @returns {void}
   */
  sendConfigChange: (data) => {
    ipcRenderer.send('config-changed', data);
  },
  
  /**
   * 监听来自主进程的配置更新
   * @param {function(ConfigUpdateData): void} callback - 回调函数
   * @returns {void}
   */
  onConfigUpdate: (callback) => {
    ipcRenderer.on('config-updated', (event, data) => {
      callback(data);
    });
  },
  
  /**
   * 移除所有配置更新监听器
   * @returns {void}
   */
  removeConfigUpdateListener: () => {
    ipcRenderer.removeAllListeners('config-updated');
  },
  
  /**
   * 通过IPC执行文件操作
   * @async
   * @param {string} action - 操作类型（readFile、readJSON、writeFile、writeJSON、exist、mkdir、ls、lsDir、lsFile、delete、copy、move）
   * @param {Object} params - 操作参数
   * @returns {Promise<FileOperationResult>} 操作结果
   */
  fileOperation: async (action, params) => {
    return await ipcRenderer.invoke('file-operation', { action, params });
  }
});
