/**
 * # Security Manager
 * ## 核心职责
 * - 窗口级安全上下文管理
 * - 动态Preload脚本生成
 * - 权限策略管理
 * - Token生命周期管理
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { app } from "electron";
import { createTokenWithPreset } from "../capability/token.js";

// ==============================
// 🔐 权限策略定义
// ==============================
const PERMISSION_PRESETS = {
  READ_ONLY: {
    fs: ["read", "exists", "ls"],
    hide: [],
    zip: ["zip"],
    user: ["load", "list"],
    locale: ["load"],
    theme: ["load"],
    icon: ["load"],
  },
  READ_WRITE: {
    fs: ["read", "write", "exists", "ls", "mkdir"],
    hide: ["hide", "unhide"],
    zip: ["zip", "unzip"],
    user: ["load", "save", "list"],
    locale: ["load"],
    theme: ["load", "apply"],
    icon: ["load"],
  },
  FULL: {
    fs: ["read", "write", "exists", "delete", "ls", "mkdir"],
    hide: ["hide", "unhide"],
    zip: ["zip", "unzip"],
    user: ["load", "save", "list"],
    locale: ["load"],
    theme: ["load", "apply"],
    icon: ["load"],
  },
  SAVE_ONLY: {
    fs: ["read", "write", "exists"],
    hide: [],
    zip: [],
    user: [],
    locale: [],
    theme: [],
    icon: [],
  },
  PLUGIN: {
    fs: ["read", "exists", "ls"],
    hide: [],
    zip: ["unzip"],
    user: [],
    locale: [],
    theme: [],
    icon: [],
  },
};

// ==============================
// 📝 Preload模板
// ==============================
const PRELOAD_TEMPLATE = (permissions, windowId) => `
const { contextBridge, ipcRenderer } = require("electron");

// Window ID: ${windowId}
// Generated at: ${new Date().toISOString()}

const ALLOWED_CHANNELS = new Set(${JSON.stringify(getAllowedChannels(permissions))});

const invoke = (channel, ...args) => {
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new Error("[safe-io] blocked channel: " + channel);
  }
  return ipcRenderer.invoke(channel, ...args);
};

const assertToken = (token) => {
  if (!token || typeof token !== "object") throw new Error("invalid token");
  if (!token.id || !token.signature) throw new Error("invalid token structure");
};

const api = {};

${generateFSAPI(permissions)}
${generateHideAPI(permissions)}
${generateZipAPI(permissions)}
${generateUserAPI(permissions)}
${generateLocaleAPI(permissions)}
${generateThemeAPI(permissions)}
${generateIconAPI(permissions)}
${generateCapAPI()}
${generateStorageAPI()}

contextBridge.exposeInMainWorld("safeIO", api);
`;

// ==============================
// 🔧 辅助函数
// ==============================
function getAllowedChannels(permissions) {
  const channels = [];
  
  if (permissions.fs?.includes("read")) channels.push("fs:read");
  if (permissions.fs?.includes("write")) channels.push("fs:write");
  if (permissions.fs?.includes("exists")) channels.push("fs:exists");
  if (permissions.fs?.includes("delete")) channels.push("fs:delete");
  if (permissions.fs?.includes("ls")) channels.push("fs:ls");
  if (permissions.fs?.includes("mkdir")) channels.push("fs:mkdir");
  
  if (permissions.hide?.includes("hide")) channels.push("fs:hide");
  if (permissions.hide?.includes("unhide")) channels.push("fs:unhide");
  
  if (permissions.zip?.includes("zip")) channels.push("fs:zip");
  if (permissions.zip?.includes("unzip")) channels.push("fs:unzip");
  
  if (permissions.user?.includes("load")) channels.push("user:load");
  if (permissions.user?.includes("save")) channels.push("user:save");
  if (permissions.user?.includes("list")) channels.push("user:list");
  
  if (permissions.locale?.includes("load")) channels.push("locale:load");
  
  if (permissions.theme?.includes("load")) channels.push("theme:load");
  if (permissions.theme?.includes("apply")) channels.push("theme:apply");
  
  if (permissions.icon?.includes("load")) channels.push("icon:load");
  
  channels.push("cap:revoke");
  channels.push("window:create");
  channels.push("window:close");
  channels.push("storage:authorize-save");
  channels.push("storage:authorize-plugin");
  channels.push("storage:authorize-resource");
  channels.push("storage:get-directories");
  
  return channels;
}

function generateFSAPI(permissions) {
  const methods = [];
  if (permissions.fs?.includes("read")) {
    methods.push('read: (token) => { assertToken(token); return invoke("fs:read", token); }');
  }
  if (permissions.fs?.includes("write")) {
    methods.push('write: (token, content) => { assertToken(token); return invoke("fs:write", token, content); }');
  }
  if (permissions.fs?.includes("exists")) {
    methods.push('exists: (token) => { assertToken(token); return invoke("fs:exists", token); }');
  }
  if (permissions.fs?.includes("delete")) {
    methods.push('delete: (token) => { assertToken(token); return invoke("fs:delete", token); }');
  }
  if (permissions.fs?.includes("ls")) {
    methods.push('ls: (token) => { assertToken(token); return invoke("fs:ls", token); }');
  }
  if (permissions.fs?.includes("mkdir")) {
    methods.push('mkdir: (token) => { assertToken(token); return invoke("fs:mkdir", token); }');
  }
  
  if (methods.length === 0) return '';
  return `api.fs = { ${methods.join(', ')} };`;
}

function generateHideAPI(permissions) {
  const methods = [];
  if (permissions.hide?.includes("hide")) {
    methods.push('hide: (token) => { assertToken(token); return invoke("fs:hide", token); }');
  }
  if (permissions.hide?.includes("unhide")) {
    methods.push('unhide: (token) => { assertToken(token); return invoke("fs:unhide", token); }');
  }
  
  if (methods.length === 0) return '';
  return `api.hide = { ${methods.join(', ')} };`;
}

function generateZipAPI(permissions) {
  const methods = [];
  if (permissions.zip?.includes("zip")) {
    methods.push('zip: (token, outPath) => { assertToken(token); return invoke("fs:zip", token, outPath); }');
  }
  if (permissions.zip?.includes("unzip")) {
    methods.push('unzip: (token, outDir) => { assertToken(token); return invoke("fs:unzip", token, outDir); }');
  }
  
  if (methods.length === 0) return '';
  return `api.zip = { ${methods.join(', ')} };`;
}

function generateUserAPI(permissions) {
  const methods = [];
  if (permissions.user?.includes("load")) {
    methods.push('load: (userId, token) => { assertToken(token); return invoke("user:load", userId, token); }');
  }
  if (permissions.user?.includes("save")) {
    methods.push('save: (userId, data, token) => { assertToken(token); return invoke("user:save", userId, data, token); }');
  }
  if (permissions.user?.includes("list")) {
    methods.push('list: (token) => { assertToken(token); return invoke("user:list", token); }');
  }
  
  if (methods.length === 0) return '';
  return `api.user = { ${methods.join(', ')} };`;
}

function generateLocaleAPI(permissions) {
  if (!permissions.locale?.includes("load")) return '';
  return 'api.locale = { load: (localeId, token) => { assertToken(token); return invoke("locale:load", localeId, token); } };';
}

function generateThemeAPI(permissions) {
  const methods = [];
  if (permissions.theme?.includes("load")) {
    methods.push('load: (themeId, token) => { assertToken(token); return invoke("theme:load", themeId, token); }');
  }
  if (permissions.theme?.includes("apply")) {
    methods.push('apply: (themeId, token) => { assertToken(token); return invoke("theme:apply", themeId, token); }');
  }
  
  if (methods.length === 0) return '';
  return `api.theme = { ${methods.join(', ')} };`;
}

function generateIconAPI(permissions) {
  if (!permissions.icon?.includes("load")) return '';
  return 'api.icon = { load: (iconPackId, token) => { assertToken(token); return invoke("icon:load", iconPackId, token); } };';
}

function generateCapAPI() {
  return 'api.cap = { revoke: (tokenId) => invoke("cap:revoke", tokenId) };';
}

function generateStorageAPI() {
  return `
api.storage = {
  authorizeSave: (saveName) => invoke("storage:authorize-save", saveName),
  authorizePlugin: (pluginId) => invoke("storage:authorize-plugin", pluginId),
  authorizeResource: (resourcePackId) => invoke("storage:authorize-resource", resourcePackId),
  getDirectories: () => invoke("storage:get-directories"),
};
api.window = {
  create: (config) => invoke("window:create", config),
  close: (windowId) => invoke("window:close", windowId),
};
`;
}

// ==============================
// 🎯 Security Manager 类
// ==============================
class SecurityManager {
  constructor() {
    this.contexts = new Map();
    this.preloadCache = new Map();
    this.preloadDir = path.join(app.getPath("userData"), "preloads");
    
    // 确保preload目录存在
    if (!fs.existsSync(this.preloadDir)) {
      fs.mkdirSync(this.preloadDir, { recursive: true });
    }
  }

  /**
   * 创建安全上下文
   * @param {Object} options
   * @param {string} options.windowId
   * @param {string} options.preset - 权限预设名称
   * @param {string} [options.bindFile]
   * @returns {Object} securityContext
   */
  createContext(options) {
    const { windowId, preset = "READ_ONLY", bindFile } = options;
    
    // 获取权限配置
    const permissions = PERMISSION_PRESETS[preset] || PERMISSION_PRESETS.READ_ONLY;
    
    // 创建token
    const token = createTokenWithPreset(bindFile || this.preloadDir, preset);
    
    // 创建上下文
    const context = {
      id: randomUUID(),
      windowId,
      preset,
      permissions,
      token,
      tokenId: token.id,
      bindFile,
      createdAt: Date.now(),
    };
    
    // 存储上下文
    this.contexts.set(windowId, context);
    
    return context;
  }

  /**
   * 销毁安全上下文
   * @param {string} windowId
   */
  destroyContext(windowId) {
    const context = this.contexts.get(windowId);
    
    if (context) {
      // 删除缓存的preload文件
      const preloadPath = this.getPreloadPath(windowId);
      if (fs.existsSync(preloadPath)) {
        fs.unlinkSync(preloadPath);
      }
      
      // 清理缓存
      this.preloadCache.delete(windowId);
      this.contexts.delete(windowId);
    }
  }

  /**
   * 获取安全上下文
   * @param {string} windowId
   * @returns {Object|null}
   */
  getContext(windowId) {
    return this.contexts.get(windowId) || null;
  }

  /**
   * 生成动态preload脚本
   * @param {string} windowId
   * @param {Object} securityContext
   * @returns {string} preload文件路径
   */
  generatePreload(windowId, securityContext) {
    const preloadPath = this.getPreloadPath(windowId);
    
    // 如果缓存存在，直接返回
    if (this.preloadCache.has(windowId)) {
      return preloadPath;
    }
    
    // 生成preload内容
    const content = PRELOAD_TEMPLATE(securityContext.permissions, windowId);
    
    // 写入文件
    fs.writeFileSync(preloadPath, content);
    
    // 更新缓存
    this.preloadCache.set(windowId, {
      path: preloadPath,
      generatedAt: Date.now(),
      preset: securityContext.preset,
    });
    
    return preloadPath;
  }

  /**
   * 获取preload文件路径
   * @param {string} windowId
   * @returns {string}
   */
  getPreloadPath(windowId) {
    const sanitizedId = windowId.replace(/[^a-zA-Z0-9\-]/g, "_");
    return path.join(this.preloadDir, `preload-${sanitizedId}.js`);
  }

  /**
   * 更新窗口权限
   * @param {string} windowId
   * @param {string} newPreset
   * @returns {boolean}
   */
  updatePermissions(windowId, newPreset) {
    const context = this.contexts.get(windowId);
    if (!context) return false;
    
    // 更新预设和权限
    context.preset = newPreset;
    context.permissions = PERMISSION_PRESETS[newPreset] || PERMISSION_PRESETS.READ_ONLY;
    
    // 重新生成preload
    this.generatePreload(windowId, context);
    
    return true;
  }

  /**
   * 获取所有上下文摘要
   * @returns {Array}
   */
  getContextsSummary() {
    const summaries = [];
    this.contexts.forEach((ctx, id) => {
      summaries.push({
        windowId: id,
        preset: ctx.preset,
        createdAt: ctx.createdAt,
        bindFile: ctx.bindFile,
      });
    });
    return summaries;
  }
}

// ==============================
// 📦 导出
// ==============================
export { SecurityManager, PERMISSION_PRESETS };
