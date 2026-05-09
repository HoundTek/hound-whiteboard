/**
 * # Preload Script (默认/后备版本)
 * ## 说明
 * 此文件为默认preload，用于初始窗口或权限未知时
 * 实际生产环境中，窗口会使用SecurityManager动态生成的preload
 */

const { contextBridge, ipcRenderer } = require("electron");

// ==============================
// 🔐 默认允许的IPC通道（最小权限）
// ==============================
const ALLOWED_CHANNELS = new Set([
  // 安全管理
  "cap:revoke",
  
  // 窗口管理
  "window:create",
  "window:close",
  
  // 存储授权
  "storage:authorize-save",
  "storage:authorize-plugin",
  "storage:authorize-resource",
  "storage:get-directories",
  
  // 基础用户操作
  "user:load",
  "user:list",
  
  // 基础主题和国际化
  "theme:load",
  "locale:load",
]);

// ==============================
// 🧠 invoke wrapper
// ==============================
const invoke = (channel, ...args) => {
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new Error(`[safe-io] blocked channel: ${channel}`);
  }
  return ipcRenderer.invoke(channel, ...args);
};

// ==============================
// 🔑 token guard
// ==============================
const assertToken = (token) => {
  if (!token || typeof token !== "object") {
    throw new Error("invalid token");
  }
  if (!token.id || !token.signature) {
    throw new Error("invalid token structure");
  }
};

// ==============================
// 📦 API定义（最小权限集）
// ==============================
const api = {
  // 权限控制
  cap: {
    revoke: (tokenId) => invoke("cap:revoke", tokenId),
  },
  
  // 窗口管理
  window: {
    create: (config) => invoke("window:create", config),
    close: (windowId) => invoke("window:close", windowId),
  },
  
  // 存储授权
  storage: {
    authorizeSave: (saveName) => invoke("storage:authorize-save", saveName),
    authorizePlugin: (pluginId) => invoke("storage:authorize-plugin", pluginId),
    authorizeResource: (resourcePackId) => invoke("storage:authorize-resource", resourcePackId),
    getDirectories: () => invoke("storage:get-directories"),
  },
  
  // 用户（只读）
  user: {
    load: (userId, token) => {
      assertToken(token);
      return invoke("user:load", userId, token);
    },
    list: (token) => {
      assertToken(token);
      return invoke("user:list", token);
    },
  },
  
  // 主题（只读）
  theme: {
    load: (themeId, token) => {
      assertToken(token);
      return invoke("theme:load", themeId, token);
    },
  },
  
  // 国际化（只读）
  locale: {
    load: (localeId, token) => {
      assertToken(token);
      return invoke("locale:load", localeId, token);
    },
  },
};

// ==============================
// 🌉 expose safe API
// ==============================
contextBridge.exposeInMainWorld("safeIO", api);

// ==============================
// 📢 安全事件监听
// ==============================
ipcRenderer.on("security:init", (event, data) => {
  console.log("[safe-io] Security initialized:", data);
  // 创建并分发自定义事件到渲染进程
  const securityEvent = new CustomEvent("security:init", { detail: data });
  window.dispatchEvent(securityEvent);
});
