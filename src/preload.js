const { contextBridge, ipcRenderer } = require("electron");

// ==============================
// 🔐 allowed IPC channels
// ==============================

const ALLOWED_CHANNELS = new Set([
  // fs
  "fs:read",
  "fs:write",
  "fs:exists",
  "fs:delete",
  "fs:ls",
  "fs:mkdir",
  "fs:zip",
  "fs:unzip",
  "fs:hide",
  "fs:unhide",

  // cap
  "cap:revoke",

  // user
  "user:load",
  "user:save",
  "user:list",

  // locale
  "locale:load",

  // theme
  "theme:load",
  "theme:apply",

  // icon
  "icon:load",
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
// 📦 FS API
// ==============================

const fs = {
  read: (token) => {
    assertToken(token);
    return invoke("fs:read", token);
  },

  write: (token, content) => {
    assertToken(token);
    return invoke("fs:write", token, content);
  },

  exists: (token) => {
    assertToken(token);
    return invoke("fs:exists", token);
  },

  delete: (token) => {
    assertToken(token);
    return invoke("fs:delete", token);
  },

  ls: (token, options) => {
    assertToken(token);
    return invoke("fs:ls", token, options);
  },

  mkdir: (token) => {
    assertToken(token);
    return invoke("fs:mkdir", token);
  },

  zip: (token, outPath) => {
    assertToken(token);
    return invoke("fs:zip", token, outPath);
  },

  unzip: (token, outDir) => {
    assertToken(token);
    return invoke("fs:unzip", token, outDir);
  },
};

// ==============================
// 👁 hide API
// ==============================

const hide = {
  hide: (token) => {
    assertToken(token);
    return invoke("fs:hide", token);
  },

  unhide: (token) => {
    assertToken(token);
    return invoke("fs:unhide", token);
  },
};

// ==============================
// 🔐 capability control
// ==============================

const cap = {
  revoke: (tokenId) => invoke("cap:revoke", tokenId),
};

// ==============================
// 👤 user API (NEW)
// ==============================

const user = {
  load: (userId, token) => {
    assertToken(token);
    return invoke("user:load", userId, token);
  },

  save: (userId, data, token) => {
    assertToken(token);
    return invoke("user:save", userId, data, token);
  },

  list: (token) => {
    assertToken(token);
    return invoke("user:list", token);
  },
};

// ==============================
// 🌐 locale / i18n API (NEW)
// ==============================

const locale = {
  load: (localeId, token) => {
    assertToken(token);
    return invoke("locale:load", localeId, token);
  },
};

// ==============================
// 🎨 theme API (NEW)
// ==============================

const theme = {
  load: (themeId, token) => {
    assertToken(token);
    return invoke("theme:load", themeId, token);
  },

  apply: (themeId, token) => {
    assertToken(token);
    return invoke("theme:apply", themeId, token);
  },
};

// ==============================
// 🎨 icon API (NEW)
// ==============================

const icon = {
  load: (iconPackId, token) => {
    assertToken(token);
    return invoke("icon:load", iconPackId, token);
  },
};

// ==============================
// 🌉 expose safe API
// ==============================

contextBridge.exposeInMainWorld("safeIO", {
  fs,
  hide,
  cap,
  user,
  locale,
  theme,
  icon,
});