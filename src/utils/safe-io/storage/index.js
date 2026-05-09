/**
 * @fileoverview Safe Storage Module - 存档、插件与资源包管理
 * @module safe-io/storage
 *
 * @description
 * 提供统一的安全存储管理，包括：
 * - SaveManager: 存档文件管理（创建、读取、保存、删除）
 * - PluginManager: 插件管理（安装、加载、卸载）
 * - ResourcePackManager: 资源包管理（加载、应用）
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { registerRoot } from "../auth/authorize.js";

/** @constant {Object} STORAGE_TYPES - 存储类型枚举 */
const STORAGE_TYPES = {
  SAVE_DATA: "save_data",
  PLUGINS: "plugins",
  RESOURCE_PACKS: "resource_packs",
  CACHE: "cache",
  LOGS: "logs",
};

/**
 * @typedef {Object} SaveData
 * @property {string} id - 存档ID
 * @property {string} name - 存档名称
 * @property {Object} data - 存档数据
 * @property {number} createdAt - 创建时间戳
 * @property {number} modifiedAt - 修改时间戳
 * @property {string} version - 版本号
 */

/**
 * @typedef {Object} SaveResult
 * @property {boolean} success - 是否成功
 * @property {string} [saveId] - 存档ID
 * @property {string} [path] - 存档路径
 * @property {SaveData} [data] - 存档数据
 * @property {string} [error] - 错误信息
 */

/**
 * @typedef {Object} PluginManifest
 * @property {string} id - 插件ID
 * @property {string} name - 插件名称
 * @property {string} version - 版本号
 * @property {string} [description] - 描述
 * @property {string} [author] - 作者
 */

/**
 * @typedef {Object} Plugin
 * @property {string} id - 插件ID
 * @property {PluginManifest} manifest - 插件清单
 * @property {string} path - 插件路径
 * @property {boolean} loaded - 是否已加载
 */

/**
 * @typedef {Object} PluginResult
 * @property {boolean} success - 是否成功
 * @property {string} [pluginId] - 插件ID
 * @property {PluginManifest} [manifest] - 插件清单
 * @property {Plugin} [plugin] - 插件对象
 * @property {string} [error] - 错误信息
 */

/**
 * @typedef {Object} ResourcePackManifest
 * @property {string} id - 资源包ID
 * @property {string} name - 资源包名称
 * @property {string} version - 版本号
 * @property {string} [description] - 描述
 */

/**
 * @typedef {Object} ResourcePack
 * @property {string} id - 资源包ID
 * @property {ResourcePackManifest} manifest - 资源包清单
 * @property {string} path - 资源包路径
 * @property {boolean} active - 是否激活
 */

/**
 * @typedef {Object} ResourcePackResult
 * @property {boolean} success - 是否成功
 * @property {string} [packId] - 资源包ID
 * @property {ResourcePackManifest} [manifest] - 资源包清单
 * @property {string} [error] - 错误信息
 */

/**
 * 存档管理器
 */
class SaveManager {
  /**
   * @param {string} baseDir - 存档基础目录
   */
  constructor(baseDir) {
    /** @type {string} */
    this.baseDir = baseDir;
    this.ensureDirectory();
  }

  /** 确保目录存在 */
  ensureDirectory() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    registerRoot(this.baseDir);
  }

  /**
   * 创建新存档
   * @param {string} name - 存档名称
   * @param {Object} [data={}] - 存档数据
   * @returns {SaveResult}
   */
  create(name, data = {}) {
    const saveId = `${name}_${Date.now()}`;
    const savePath = path.join(this.baseDir, `${saveId}.json`);

    try {
      /** @type {SaveData} */
      const saveData = {
        id: saveId,
        name,
        data,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        version: "1.0.0",
      };

      fs.writeFileSync(savePath, JSON.stringify(saveData, null, 2));

      return { success: true, saveId, path: savePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 读取存档
   * @param {string} saveId - 存档ID
   * @returns {SaveResult & {data?: SaveData}}
   */
  read(saveId) {
    const savePath = path.join(this.baseDir, `${saveId}.json`);

    try {
      if (!fs.existsSync(savePath)) {
        return { success: false, error: "存档不存在" };
      }

      const content = fs.readFileSync(savePath, "utf-8");
      const saveData = JSON.parse(content);

      return { success: true, data: saveData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 更新存档
   * @param {string} saveId - 存档ID
   * @param {Object} data - 更新的数据
   * @returns {SaveResult}
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
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除存档
   * @param {string} saveId - 存档ID
   * @returns {SaveResult}
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
      return { success: false, error: error.message };
    }
  }

  /**
   * 列出所有存档
   * @returns {SaveResult & {saves?: Array}}
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

      return { success: true, saves };
    } catch (error) {
      return { success: false, error: error.message };
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

/**
 * 插件管理器
 */
class PluginManager {
  /**
   * @param {string} baseDir - 插件基础目录
   */
  constructor(baseDir) {
    /** @type {string} */
    this.baseDir = baseDir;
    /** @type {Map<string, Plugin>} */
    this.plugins = new Map();
    this.ensureDirectory();
  }

  /** 确保目录存在 */
  ensureDirectory() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    registerRoot(this.baseDir);
  }

  /**
   * 安装插件
   * @param {string} pluginDir - 插件目录
   * @returns {PluginResult}
   */
  install(pluginDir) {
    try {
      const manifestPath = path.join(pluginDir, "manifest.json");

      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: "插件缺少manifest.json" };
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const pluginId = manifest.id || path.basename(pluginDir);

      const targetDir = path.join(this.baseDir, pluginId);
      if (fs.existsSync(targetDir)) {
        return { success: false, error: "插件已安装" };
      }

      this.copyDirectory(pluginDir, targetDir);

      this.plugins.set(pluginId, {
        id: pluginId,
        manifest,
        path: targetDir,
        loaded: false,
      });

      return { success: true, pluginId, manifest };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 加载插件
   * @param {string} pluginId - 插件ID
   * @returns {PluginResult}
   */
  load(pluginId) {
    try {
      let plugin = this.plugins.get(pluginId);

      if (!plugin) {
        const pluginDir = path.join(this.baseDir, pluginId);
        if (!fs.existsSync(pluginDir)) {
          return { success: false, error: "插件不存在" };
        }

        const manifestPath = path.join(pluginDir, "manifest.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

        plugin = {
          id: pluginId,
          manifest,
          path: pluginDir,
          loaded: false,
        };

        this.plugins.set(pluginId, plugin);
      }

      if (!plugin.loaded) {
        plugin.loaded = true;
      }

      return { success: true, plugin };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 卸载插件
   * @param {string} pluginId - 插件ID
   * @returns {PluginResult}
   */
  uninstall(pluginId) {
    try {
      const pluginDir = path.join(this.baseDir, pluginId);

      if (!fs.existsSync(pluginDir)) {
        return { success: false, error: "插件不存在" };
      }

      this.deleteDirectory(pluginDir);
      this.plugins.delete(pluginId);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 列出所有插件
   * @returns {PluginResult & {plugins?: Array}}
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

      return { success: true, plugins };
    } catch (error) {
      return { success: false, error: error.message };
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

  /**
   * 复制目录
   * @param {string} src - 源路径
   * @param {string} dest - 目标路径
   */
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

  /**
   * 删除目录
   * @param {string} dir - 目录路径
   */
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

/**
 * 资源包管理器
 */
class ResourcePackManager {
  /**
   * @param {string} baseDir - 资源包基础目录
   */
  constructor(baseDir) {
    /** @type {string} */
    this.baseDir = baseDir;
    /** @type {Map<string, ResourcePack>} */
    this.resourcePacks = new Map();
    /** @type {string|null} */
    this.activePack = null;
    this.ensureDirectory();
  }

  /** 确保目录存在 */
  ensureDirectory() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    registerRoot(this.baseDir);
  }

  /**
   * 安装资源包
   * @param {string} packPath - 资源包路径
   * @returns {ResourcePackResult}
   */
  install(packPath) {
    try {
      const stats = fs.statSync(packPath);
      let unpackedDir = packPath;

      if (!stats.isDirectory()) {
        unpackedDir = path.join(this.baseDir, `temp_${randomUUID()}`);
        fs.mkdirSync(unpackedDir, { recursive: true });
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
        this.deleteDirectory(targetDir);
      }

      fs.renameSync(unpackedDir, targetDir);

      this.resourcePacks.set(packId, {
        id: packId,
        manifest,
        path: targetDir,
        active: false,
      });

      return { success: true, packId, manifest };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 应用资源包
   * @param {string} packId - 资源包ID
   * @returns {ResourcePackResult}
   */
  apply(packId) {
    try {
      let pack = this.resourcePacks.get(packId);

      if (!pack) {
        const packDir = path.join(this.baseDir, packId);
        if (!fs.existsSync(packDir)) {
          return { success: false, error: "资源包不存在" };
        }

        const manifestPath = path.join(packDir, "manifest.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

        pack = {
          id: packId,
          manifest,
          path: packDir,
          active: false,
        };

        this.resourcePacks.set(packId, pack);
      }

      if (this.activePack) {
        const prevPack = this.resourcePacks.get(this.activePack);
        if (prevPack) {
          prevPack.active = false;
        }
      }

      pack.active = true;
      this.activePack = packId;

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 卸载资源包
   * @param {string} packId - 资源包ID
   * @returns {ResourcePackResult}
   */
  uninstall(packId) {
    try {
      const packDir = path.join(this.baseDir, packId);

      if (!fs.existsSync(packDir)) {
        return { success: false, error: "资源包不存在" };
      }

      if (this.activePack === packId) {
        this.activePack = null;
      }

      this.deleteDirectory(packDir);
      this.resourcePacks.delete(packId);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 列出所有资源包
   * @returns {ResourcePackResult & {packs?: Array}}
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

      return { success: true, packs };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取资源路径
   * @param {string} resourcePath - 资源相对路径
   * @returns {string|null}
   */
  getResourcePath(resourcePath) {
    if (this.activePack) {
      const packDir = path.join(this.baseDir, this.activePack);
      const fullPath = path.join(packDir, resourcePath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    for (const [packId, pack] of this.resourcePacks) {
      const fullPath = path.join(pack.path, resourcePath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }

  /**
   * 删除目录
   * @param {string} dir - 目录路径
   */
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

/**
 * 统一存储管理器
 */
class SecureStorageManager {
  /**
   * @param {string} appDataPath - 应用数据路径
   */
  constructor(appDataPath) {
    /** @type {string} */
    this.baseDir = path.join(appDataPath, "HoundWhiteboard");

    /** @type {Object.<string, string>} */
    this.dirs = {
      saves: path.join(this.baseDir, "saves"),
      plugins: path.join(this.baseDir, "plugins"),
      resources: path.join(this.baseDir, "resources"),
      cache: path.join(this.baseDir, "cache"),
      logs: path.join(this.baseDir, "logs"),
    };

    /** @type {SaveManager} */
    this.saveManager = new SaveManager(this.dirs.saves);
    /** @type {PluginManager} */
    this.pluginManager = new PluginManager(this.dirs.plugins);
    /** @type {ResourcePackManager} */
    this.resourcePackManager = new ResourcePackManager(this.dirs.resources);

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
    return {
      type: "save",
      path: savePath,
      permissions: ["read", "write", "delete"],
      expiresAt: Date.now() + 3600000,
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

export {
  SecureStorageManager,
  SaveManager,
  PluginManager,
  ResourcePackManager,
  STORAGE_TYPES
};