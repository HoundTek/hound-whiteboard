/**
 * # Path Detector（路径检测器）
 * 
 * ## 核心职责
 * - 检测应用数据目录
 * - 支持 Portable（便携）模式和 Standard（常规）模式
 * - 提供统一的目录路径管理
 * 
 * ## 运行模式
 * 
 * ### Portable（便携）模式
 * - 条件：可执行文件目录下存在 `data/` 目录
 * - 数据目录：`{exeDir}/data/`
 * - 用途：适合 U 盘携带、绿色版分发
 * 
 * ### Standard（常规）模式
 * - 条件：可执行文件目录下不存在 `data/` 目录
 * - 数据目录：`{appData}/HoundWhiteboard/data/`
 * - 用途：常规安装运行
 */

import { app } from "electron";
import fs from "fs";
import path from "path";

// ==============================
// 🎯 目录检测核心逻辑
// ==============================

/**
 * 检测并返回应用数据根目录
 * @returns {string} 应用数据根目录路径
 */
export function detectAppRoot() {
  const exePath = app.getPath("exe") || process.execPath;
  const installDir = path.dirname(exePath);
  const localDataDir = path.join(installDir, "data");
  
  // 检查可执行文件目录下是否存在 data/ 目录（便携模式）
  if (fs.existsSync(localDataDir)) {
    console.log(`[PathDetector] Portable mode detected. Using local data directory: ${localDataDir}`);
    return localDataDir;
  }
  
  // 否则使用系统 appdata 目录（常规模式）
  const appDataDir = path.join(app.getPath("appData"), "HoundWhiteboard", "data");
  console.log(`[PathDetector] Standard mode. Using appdata directory: ${appDataDir}`);
  return appDataDir;
}

/**
 * 获取所有标准目录路径
 * @returns {Object} 包含所有目录路径的对象
 */
export function getDirectories() {
  const appRoot = detectAppRoot();
  
  return {
    // 基础路径
    APP_DATA: app.getPath("appData"),
    EXE: app.getPath("exe") || process.execPath,
    USER_DATA: app.getPath("userData"),
    DOCUMENTS: app.getPath("documents"),
    APP_ROOT: appRoot,
    
    // 安全存储目录
    SAVE_DATA: path.join(appRoot, "saves"),        // 存档文件目录
    PLUGINS: path.join(appRoot, "plugins"),        // 插件目录
    RESOURCE_PACKS: path.join(appRoot, "resources"), // 资源包目录
    CACHE: path.join(appRoot, "cache"),            // 缓存目录
    LOGS: path.join(appRoot, "logs"),              // 日志目录
    PRELOADS: path.join(appRoot, "preloads"),      // 动态preload脚本目录
  };
}

/**
 * 确保所有目录存在
 * @param {Object} dirs - 目录对象（可选，默认使用 getDirectories()）
 */
export function ensureDirectories(dirs = getDirectories()) {
  // 确保所有安全存储目录存在
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

// ==============================
// 📦 导出
// ==============================
export default {
  detectAppRoot,
  getDirectories,
  ensureDirectories,
  getRuntimeMode,
};