/**
 * @file 渲染进程文件操作工具
 * @description 通过IPC提供统一的文件操作接口
 * @module fileUtils
 */

/**
 * @typedef {Object} FileUtils
 * @property {function(string): Promise<string>} readFile - 读取文件内容
 * @property {function(string): Promise<Object>} readJSON - 读取JSON文件
 * @property {function(string, string): Promise<boolean>} writeFile - 写入文件
 * @property {function(string, Object): Promise<boolean>} writeJSON - 写入JSON文件
 * @property {function(string, boolean): Promise<boolean>} exist - 检查文件或目录是否存在
 * @property {function(string): Promise<boolean>} mkdir - 创建目录
 * @property {function(string): Promise<string[]>} ls - 列出目录内容
 * @property {function(string): Promise<string[]>} lsDir - 列出子目录
 * @property {function(string): Promise<string[]>} lsFile - 列出文件
 * @property {function(string, boolean): Promise<boolean>} delete - 删除文件或目录
 * @property {function(string, string, boolean): Promise<boolean>} copy - 复制文件或目录
 * @property {function(string, string, boolean): Promise<boolean>} move - 移动文件或目录
 */

/**
 * 文件操作工具对象
 * @type {FileUtils}
 */
const fileUtils = {
  readFile: async (filePath) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('readFile', { filePath });
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  },
  
  readJSON: async (filePath) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('readJSON', { filePath });
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  },
  
  writeFile: async (filePath, content) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('writeFile', { filePath, content });
    if (!result.success) {
      throw new Error(result.error);
    }
    return true;
  },
  
  writeJSON: async (filePath, content) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('writeJSON', { filePath, content });
    if (!result.success) {
      throw new Error(result.error);
    }
    return true;
  },
  
  exist: async (targetPath, isFile = true) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('exist', { path: targetPath, isFile });
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  },
  
  mkdir: async (dirPath) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('mkdir', { dirPath });
    if (!result.success) {
      throw new Error(result.error);
    }
    return true;
  },
  
  ls: async (dirPath) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('ls', { dirPath });
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  },
  
  lsDir: async (dirPath) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('lsDir', { dirPath });
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  },
  
  lsFile: async (dirPath) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('lsFile', { dirPath });
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  },
  
  delete: async (targetPath, isFile = true) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('delete', { path: targetPath, isFile });
    if (!result.success) {
      throw new Error(result.error);
    }
    return true;
  },
  
  copy: async (source, dest, isFile = true) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('copy', { source, dest, isFile });
    if (!result.success) {
      throw new Error(result.error);
    }
    return true;
  },
  
  move: async (source, dest, isFile = true) => {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    const result = await window.electronAPI.fileOperation('move', { source, dest, isFile });
    if (!result.success) {
      throw new Error(result.error);
    }

    return true;
  }
};

window.fileUtils = fileUtils;
