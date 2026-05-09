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
  /**
   * 读取文件内容
   * @async
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} 文件内容
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 读取JSON文件
   * @async
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} JSON对象
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 写入文件
   * @async
   * @param {string} filePath - 文件路径
   * @param {string} content - 文件内容
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 写入JSON文件
   * @async
   * @param {string} filePath - 文件路径
   * @param {Object} content - JSON对象
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 检查文件或目录是否存在
   * @async
   * @param {string} targetPath - 目标路径
   * @param {boolean} [isFile=true] - 是否为文件
   * @returns {Promise<boolean>} 是否存在
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 创建目录
   * @async
   * @param {string} dirPath - 目录路径
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 列出目录内容
   * @async
   * @param {string} dirPath - 目录路径
   * @returns {Promise<string[]>} 文件和目录名数组
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 列出子目录
   * @async
   * @param {string} dirPath - 目录路径
   * @returns {Promise<string[]>} 子目录路径数组
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 列出文件
   * @async
   * @param {string} dirPath - 目录路径
   * @returns {Promise<string[]>} 文件路径数组
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 删除文件或目录
   * @async
   * @param {string} targetPath - 目标路径
   * @param {boolean} [isFile=true] - 是否为文件
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 复制文件或目录
   * @async
   * @param {string} source - 源路径
   * @param {string} dest - 目标路径
   * @param {boolean} [isFile=true] - 是否为文件
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} Electron API不可用或操作失败
   */
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
  
  /**
   * 移动文件或目录
   * @async
   * @param {string} source - 源路径
   * @param {string} dest - 目标路径
   * @param {boolean} [isFile=true] - 是否为文件
   * @returns {Promise<boolean>} 是否成功
   * @throws {Error} Electron API不可用或操作失败
   */
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

/**
 * 暴露到全局window对象
 * @global
 * @type {FileUtils}
 */
window.fileUtils = fileUtils;
