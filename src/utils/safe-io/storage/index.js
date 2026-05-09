/**
 * # 安全存储模块
 * ## 核心功能
 * - 存档文件管理（创建、读取、保存、删除）
 * - 插件管理（安装、加载、卸载）
 * - 资源包管理（加载、应用）
 * - 统一的安全访问控制
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { registerRoot } from "../auth/authorize.js";

// ==============================
// 📂 存储类型定义
// ==============================
const STORAGE_TYPES = {
  SAVE_DATA: "save_data",
  PLUGINS: "plugins",
  RESOURCE_PACKS: "resource_packs",
  CACHE: "cache",
  LOGS: "logs",
};

// ==============================
// 📦 存档管理
// ==============================
class SaveManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.ensureDirectory();
  }

  ensureDirectory() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    registerRoot(this.baseDir);
  }

  /**
   * 创建新存档
   * @param {string} name - 存档名称
   * @param {Object} data - 存档数据
   * @returns {Object} { success, saveId, path }
   */
  create(name, data = {}) {
    const saveId = `${name}_${Date.now()}`;
    const savePath = path.join(this.baseDir, `${saveId}.json`);
    
    try {
      const saveData = {
        id: saveId,
        name,
        data,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        version: "1.0.0",
      };
      
      fs.writeFileSync(savePath, JSON.stringify(saveData, null, 2));
      
      return {
        success: true,
        saveId,
        path: savePath,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 读取存档
   * @param {string} saveId - 存档ID
   * @returns {Object} { success, data }
   */
  read(saveId) {
    const savePath = path.join(this.baseDir, `${saveId}.json`);
    
    try {
      if (!fs.existsSync(savePath)) {
        return { success: false, error: "存档不存在" };
      }
      
      const content = fs.readFileSync(savePath, "utf-8");
      const saveData = JSON.parse(content);
      
      return {
        success: true,
        data: saveData,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 更新存档
   * @param {string} saveId - 存档ID
   * @param {Object} data - 更新的数据
   * @returns {Object} { success }
   */
  update(saveId, data) {
    const savePath = path.join(this.baseDir, `${saveId}.json`);
    
    try {
      if (!fs.existsSync(savePath)) {
        return { success: false, error: "存档不存在" };
      }
      
      const content = fs.readFileSync(savePath, "utf-8");
      const saveData = JSON.parse(content);
      
      saveData.data = { ...saveData.data, ...data };
      saveData.modifiedAt = Date.now();
      
      fs.writeFileSync(savePath, JSON.stringify(saveData, null, 2));
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 删除存档
   * @param {string} saveId - 存档ID
   * @returns {Object} { success }
   */
  delete(saveId) {
    const savePath = path.join(this.baseDir, `${saveId}.json`);
    
    try {
      if (!fs.existsSync(savePath)) {
        return { success: false, error: "存档不存在" };
      }
      
      fs.unlinkSync(savePath);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 列出所有存档
   * @returns {Object} { success, saves }
   */
  list() {
    try {
      const files = fs.readdirSync(this.baseDir);
      const saves = files
        .filter(file => file.endsWith(".json"))
        .map(file => {
          const saveId = file.replace(".json", "");
          const savePath = path.join(this.baseDir, file);
          const stats = fs.statSync(savePath);
          
          return {
            id: saveId,
            name: saveId.split("_")[0],
            createdAt: stats.birthtime.getTime(),
            modifiedAt: stats.mtime.getTime(),
            size: stats.size,
          };
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
      
      return {
        success: true,
        saves,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取存档路径
   * @param {string} saveId - 存档ID
   * @returns {string|null}
   */
  getPath(saveId) {
    const savePath = path.join(this.baseDir, `${saveId}.json`);
    return fs.existsSync(savePath) ? savePath : null;
  }
}

// ==============================
// 🔌 插件管理
// ==============================
class PluginManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.plugins = new Map(); // 缓存已加载的插件
    this.ensureDirectory();
  }

  ensureDirectory() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    registerRoot(this.baseDir);
  }

  /**
   * 安装插件（从目录加载）
   * @param {string} pluginDir - 插件目录
   * @returns {Object} { success, pluginId, manifest }
   */
  install(pluginDir) {
    try {
      const manifestPath = path.join(pluginDir, "manifest.json");
      
      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: "插件缺少manifest.json" };
      }
      
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const pluginId = manifest.id || path.basename(pluginDir);
      
      // 检查插件是否已安装
      const targetDir = path.join(this.baseDir, pluginId);
      if (fs.existsSync(targetDir)) {
        return { success: false, error: "插件已安装" };
      }
      
      // 复制插件文件
      this.copyDirectory(pluginDir, targetDir);
      
      // 注册插件
      this.plugins.set(pluginId, {
        id: pluginId,
        manifest,
        path: targetDir,
        loaded: false,
      });
      
      return {
        success: true,
        pluginId,
        manifest,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 加载插件
   * @param {string} pluginId - 插件ID
   * @returns {Object} { success, plugin }
   */
  load(pluginId) {
    try {
      const plugin = this.plugins.get(pluginId);
      
      if (!plugin) {
        // 尝试从磁盘加载
        const pluginDir = path.join(this.baseDir, pluginId);
        if (!fs.existsSync(pluginDir)) {
          return { success: false, error: "插件不存在" };
        }
        
        const manifestPath = path.join(pluginDir, "manifest.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        
        const pluginData = {
          id: pluginId,
          manifest,
          path: pluginDir,
          loaded: false,
        };
        
        this.plugins.set(pluginId, pluginData);
        plugin = pluginData;
      }
      
      if (plugin.loaded) {
        return { success: true, plugin };
      }
      
      // 标记为已加载
      plugin.loaded = true;
      
      return {
        success: true,
        plugin,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 卸载插件
   * @param {string} pluginId - 插件ID
   * @returns {Object} { success }
   */
  uninstall(pluginId) {
    try {
      const pluginDir = path.join(this.baseDir, pluginId);
      
      if (!fs.existsSync(pluginDir)) {
        return { success: false, error: "插件不存在" };
      }
      
      // 删除插件目录
      this.deleteDirectory(pluginDir);
      
      // 从缓存移除
      this.plugins.delete(pluginId);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 列出所有插件
   * @returns {Object} { success, plugins }
   */
  list() {
    try {
      const pluginDirs = fs.readdirSync(this.baseDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      const plugins = [];
      
      for (const pluginId of pluginDirs) {
        const pluginDir = path.join(this.baseDir, pluginId);
        const manifestPath = path.join(pluginDir, "manifest.json");
        
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          const cached = this.plugins.get(pluginId);
          
          plugins.push({
            id: pluginId,
            name: manifest.name || pluginId,
            version: manifest.version || "1.0.0",
            description: manifest.description || "",
            author: manifest.author || "",
            loaded: cached?.loaded || false,
          });
        }
      }
      
      return {
        success: true,
        plugins,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取插件资源路径
   * @param {string} pluginId - 插件ID
   * @param {string} resourcePath - 资源相对路径
   * @returns {string|null}
   */
  getResourcePath(pluginId, resourcePath) {
    const fullPath = path.join(this.baseDir, pluginId, resourcePath);
    return fs.existsSync(fullPath) ? fullPath : null;
  }

  // 辅助方法
  copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  deleteDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        this.deleteDirectory(entryPath);
      } else {
        fs.unlinkSync(entryPath);
      }
    }
    
    fs.rmdirSync(dir);
  }
}

// ==============================
// 🎨 资源包管理
// ==============================
class ResourcePackManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.resourcePacks = new Map();
    this.activePack = null;
    this.ensureDirectory();
  }

  ensureDirectory() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    registerRoot(this.baseDir);
  }

  /**
   * 安装资源包
   * @param {string} packPath - 资源包路径（目录或zip）
   * @returns {Object} { success, packId, manifest }
   */
  install(packPath) {
    try {
      // 检查是目录还是zip
      const stats = fs.statSync(packPath);
      let unpackedDir = packPath;
      
      if (!stats.isDirectory()) {
        // 解压zip
        unpackedDir = path.join(this.baseDir, `temp_${randomUUID()}`);
        fs.mkdirSync(unpackedDir, { recursive: true });
        // 这里应该调用unzip工具，简化处理假设是目录
        return { success: false, error: "暂不支持zip格式" };
      }
      
      const manifestPath = path.join(unpackedDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: "资源包缺少manifest.json" };
      }
      
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const packId = manifest.id || `resource_${Date.now()}`;
      
      const targetDir = path.join(this.baseDir, packId);
      if (fs.existsSync(targetDir)) {
        // 删除旧版本
        this.deleteDirectory(targetDir);
      }
      
      // 移动/复制文件
      fs.renameSync(unpackedDir, targetDir);
      
      this.resourcePacks.set(packId, {
        id: packId,
        manifest,
        path: targetDir,
        active: false,
      });
      
      return {
        success: true,
        packId,
        manifest,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 应用资源包
   * @param {string} packId - 资源包ID
   * @returns {Object} { success }
   */
  apply(packId) {
    try {
      const pack = this.resourcePacks.get(packId);
      
      if (!pack) {
        // 尝试从磁盘加载
        const packDir = path.join(this.baseDir, packId);
        if (!fs.existsSync(packDir)) {
          return { success: false, error: "资源包不存在" };
        }
        
        const manifestPath = path.join(packDir, "manifest.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        
        const packData = {
          id: packId,
          manifest,
          path: packDir,
          active: false,
        };
        
        this.resourcePacks.set(packId, packData);
        pack = packData;
      }
      
      // 取消之前激活的资源包
      if (this.activePack) {
        const prevPack = this.resourcePacks.get(this.activePack);
        if (prevPack) {
          prevPack.active = false;
        }
      }
      
      // 激活新资源包
      pack.active = true;
      this.activePack = packId;
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 卸载资源包
   * @param {string} packId - 资源包ID
   * @returns {Object} { success }
   */
  uninstall(packId) {
    try {
      const packDir = path.join(this.baseDir, packId);
      
      if (!fs.existsSync(packDir)) {
        return { success: false, error: "资源包不存在" };
      }
      
      // 如果是当前激活的资源包，取消激活
      if (this.activePack === packId) {
        this.activePack = null;
      }
      
      // 删除目录
      this.deleteDirectory(packDir);
      this.resourcePacks.delete(packId);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 列出所有资源包
   * @returns {Object} { success, packs }
   */
  list() {
    try {
      const packDirs = fs.readdirSync(this.baseDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      const packs = [];
      
      for (const packId of packDirs) {
        const packDir = path.join(this.baseDir, packId);
        const manifestPath = path.join(packDir, "manifest.json");
        
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          const cached = this.resourcePacks.get(packId);
          
          packs.push({
            id: packId,
            name: manifest.name || packId,
            version: manifest.version || "1.0.0",
            description: manifest.description || "",
            active: cached?.active || (this.activePack === packId),
          });
        }
      }
      
      return {
        success: true,
        packs,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取资源路径
   * @param {string} resourcePath - 资源相对路径
   * @returns {string|null}
   */
  getResourcePath(resourcePath) {
    // 优先从激活的资源包查找
    if (this.activePack) {
      const packDir = path.join(this.baseDir, this.activePack);
      const fullPath = path.join(packDir, resourcePath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    
    // 在所有资源包中查找
    for (const [packId, pack] of this.resourcePacks) {
      const fullPath = path.join(pack.path, resourcePath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    
    return null;
  }

  // 辅助方法
  deleteDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        this.deleteDirectory(entryPath);
      } else {
        fs.unlinkSync(entryPath);
      }
    }
    
    fs.rmdirSync(dir);
  }
}

// ==============================
// 🧠 存储管理器（统一入口）
// ==============================
class SecureStorageManager {
  constructor(appDataPath) {
    this.baseDir = path.join(appDataPath, "HoundWhiteboard");
    
    // 创建子目录
    this.dirs = {
      saves: path.join(this.baseDir, "saves"),
      plugins: path.join(this.baseDir, "plugins"),
      resources: path.join(this.baseDir, "resources"),
      cache: path.join(this.baseDir, "cache"),
      logs: path.join(this.baseDir, "logs"),
    };
    
    // 初始化管理器
    this.saveManager = new SaveManager(this.dirs.saves);
    this.pluginManager = new PluginManager(this.dirs.plugins);
    this.resourcePackManager = new ResourcePackManager(this.dirs.resources);
    
    // 确保缓存和日志目录存在
    Object.values(this.dirs).forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * 获取目录路径
   * @param {string} type - 目录类型
   * @returns {string|null}
   */
  getDirectory(type) {
    return this.dirs[type] || null;
  }

  /**
   * 创建存档授权token
   * @param {string} saveName - 存档名称
   * @returns {Object} token
   */
  authorizeSave(saveName) {
    const savePath = path.join(this.dirs.saves, `${saveName}.json`);
    // 返回授权信息
    return {
      type: "save",
      path: savePath,
      permissions: ["read", "write", "delete"],
      expiresAt: Date.now() + 3600000, // 1小时后过期
    };
  }

  /**
   * 创建插件授权token
   * @param {string} pluginId - 插件ID
   * @returns {Object} token
   */
  authorizePlugin(pluginId) {
    const pluginPath = path.join(this.dirs.plugins, pluginId);
    return {
      type: "plugin",
      path: pluginPath,
      permissions: ["read", "ls"],
      expiresAt: Date.now() + 3600000,
    };
  }

  /**
   * 创建资源包授权token
   * @param {string} packId - 资源包ID
   * @returns {Object} token
   */
  authorizeResourcePack(packId) {
    const packPath = path.join(this.dirs.resources, packId);
    return {
      type: "resource",
      path: packPath,
      permissions: ["read", "ls"],
      expiresAt: Date.now() + 3600000,
    };
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      saves: this.saveManager.list().saves?.length || 0,
      plugins: this.pluginManager.list().plugins?.length || 0,
      resourcePacks: this.resourcePackManager.list().packs?.length || 0,
      activeResourcePack: this.resourcePackManager.activePack,
    };
  }
}

// ==============================
// 📦 导出
// ==============================
export { SecureStorageManager, SaveManager, PluginManager, ResourcePackManager, STORAGE_TYPES };
