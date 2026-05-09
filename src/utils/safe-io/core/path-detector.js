/**
 * @fileoverview Path Detector - 应用数据目录检测与模式判断
 * @module safe-io/core/path-detector
 *
 * @description
 * 检测应用数据目录路径，支持 Portable（便携）模式和 Standard（常规）模式。
 *
 * ## 运行模式
 * - **Portable（便携）模式**: 可执行文件目录下存在 `data/` 目录，数据存储在 `{exeDir}/data/`
 * - **Standard（常规）模式**: 使用系统 appdata 目录，数据存储在 `{appData}/HoundWhiteboard/data/`
 */

import { app } from "electron";
import fs from "fs";
import path from "path";

/**
 * @typedef {Object} DirectoryPaths
 * @property {string} APP_DATA - 系统应用数据目录
 * @property {string} EXE - 可执行文件路径
 * @property {string} USER_DATA - 用户数据目录
 * @property {string} DOCUMENTS - 文档目录
 * @property {string} APP_ROOT - 应用数据根目录
 * @property {string} SAVE_DATA - 存档文件目录
 * @property {string} PLUGINS - 插件目录
 * @property {string} RESOURCE_PACKS - 资源包目录
 * @property {string} CACHE - 缓存目录
 * @property {string} LOGS - 日志目录
 * @property {string} PRELOADS - 动态preload脚本目录
 */

/**
 * 检测并返回应用数据根目录
 * @returns {string} 应用数据根目录路径
 */
export function detectAppRoot() {
  const exePath = app.getPath("exe") || process.execPath;
  const installDir = path.dirname(exePath);
  const localDataDir = path.join(installDir, "data");

  if (fs.existsSync(localDataDir)) {
    console.log(`[PathDetector] Portable mode detected. Using local data directory: ${localDataDir}`);
    return localDataDir;
  }

  const appDataDir = path.join(app.getPath("appData"), "HoundWhiteboard", "data");
  console.log(`[PathDetector] Standard mode. Using appdata directory: ${appDataDir}`);
  return appDataDir;
}

/**
 * 获取所有标准目录路径
 * @returns {DirectoryPaths} 包含所有目录路径的对象
 */
export function getDirectories() {
  const appRoot = detectAppRoot();

  return {
    APP_DATA: app.getPath("appData"),
    EXE: app.getPath("exe") || process.execPath,
    USER_DATA: app.getPath("userData"),
    DOCUMENTS: app.getPath("documents"),
    APP_ROOT: appRoot,
    SAVE_DATA: path.join(appRoot, "saves"),
    PLUGINS: path.join(appRoot, "plugins"),
    RESOURCE_PACKS: path.join(appRoot, "resources"),
    CACHE: path.join(appRoot, "cache"),
    LOGS: path.join(appRoot, "logs"),
    PRELOADS: path.join(appRoot, "preloads"),
  };
}

/**
 * 确保所有目录存在
 * @param {DirectoryPaths} [dirs] - 目录对象，默认使用 getDirectories()
 */
export function ensureDirectories(dirs = getDirectories()) {
  const secureDirKeys = ["SAVE_DATA", "PLUGINS", "RESOURCE_PACKS", "CACHE", "LOGS", "PRELOADS"];

  secureDirKeys.forEach(key => {
    const dir = dirs[key];
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[PathDetector] Created directory: ${dir}`);
    }
  });
}

/**
 * 获取当前运行模式
 * @returns {"portable" | "standard"} 运行模式
 */
export function getRuntimeMode() {
  const exePath = app.getPath("exe") || process.execPath;
  const installDir = path.dirname(exePath);
  const localDataDir = path.join(installDir, "data");

  return fs.existsSync(localDataDir) ? "portable" : "standard";
}

export default {
  detectAppRoot,
  getDirectories,
  ensureDirectories,
  getRuntimeMode,
};