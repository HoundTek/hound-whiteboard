/**
 * @fileoverview Authorize Module - 安全授权与路径验证层
 * @module safe-io/auth/authorize
 *
 * @description
 * 核心职责：
 * 1. 解析 entry → resolved path
 * 2. root security boundary check
 * 3. 符号链接安全检查（防止路径穿越）
 * 4. policy check（非安全核心）
 * 5. 生成 FileHandle
 * 6. 生成 signed capability token（IPC用）
 *
 * @author safe-io Team
 * @version 3.0
 */

import path from "path";
import fs from "fs";

import { Some, None } from "../functional.js";
import { FileHandle } from "../capability/handle.js";
import { createToken, createTokenWithPreset } from "../capability/token.js";
import { logAudit } from "../capability/handle.js";

/**
 * @typedef {Object} BaseDir
 * @property {string} __type - 类型标识：'BaseDir'
 * @property {string[]} segments - 路径段数组
 */

/**
 * @typedef {Object} DirEntry
 * @property {string} __type - 类型标识：'Dir'
 * @property {string} name - 目录名称
 */

/**
 * @typedef {Object} FileEntry
 * @property {string} __type - 类型标识：'File'
 * @property {string} name - 文件名称
 * @property {string} [ext] - 文件扩展名
 */

/**
 * @typedef {Object} AuthorizeOptions
 * @property {string} [preset] - 权限预设：'READ_ONLY', 'READ_WRITE', 'FULL'
 * @property {Object} [permissions] - 自定义权限对象
 */

/**
 * @typedef {Object} AuthorizeResult
 * @property {Object} handle - FileHandle实例
 * @property {Object} token - 签名后的capability token
 */

/**
 * 已授权的根目录集合
 * @type {Set<string>}
 */
const authorizedRoots = new Set();

/**
 * 注册授权根目录
 * @param {string} rootPath - 根目录路径
 * @returns {Object} Some(abs) 或 None
 */
export const registerRoot = (rootPath) => {
  if (typeof rootPath !== "string") return None();

  const abs = path.resolve(rootPath);

  try {
    // 验证路径存在且是目录
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) {
      console.warn("[safe-io] Root must be a directory");
      return None();
    }
  } catch {
    console.warn("[safe-io] Root path does not exist:", abs);
    return None();
  }

  authorizedRoots.add(abs);
  logAudit("register_root", abs, true);
  return Some(abs);
};

/**
 * 清除所有授权根目录
 * @returns {void}
 */
export const clearRoots = () => {
  authorizedRoots.clear();
  logAudit("clear_roots", "", true);
};

/**
 * 路径解析函数
 * @param {BaseDir} base - 基础目录
 * @param {DirEntry|FileEntry|null} entry - 条目（可选）
 * @returns {string} 解析后的路径
 */
const resolveEntry = (base, entry) => {
  if (!base || !base.segments || !Array.isArray(base.segments)) {
    throw new Error("Invalid base directory structure");
  }

  const basePath = path.resolve(...base.segments);

  if (!isUnderRoot(basePath)) {
    throw new Error("Base path outside authorized roots");
  }

  if (!entry) return basePath;

  if (!entry.__type) {
    throw new Error("Entry missing __type");
  }

  if (entry.__type === "Dir") {
    if (!isValidName(entry.name)) {
      throw new Error(`Invalid directory name: ${entry.name}`);
    }
    return path.join(basePath, entry.name);
  }

  if (entry.__type === "File") {
    if (!isValidName(entry.name)) {
      throw new Error(`Invalid file name: ${entry.name}`);
    }

    const fileName = entry.ext
      ? `${entry.name}.${entry.ext}`
      : entry.name;

    return path.join(basePath, fileName);
  }

  return basePath;
};

/**
 * 验证路径名称是否合法
 * @param {string} name - 路径名称
 * @returns {boolean} 是否合法
 */
const isValidName = (name) => {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 255) return false;
  
  // 禁止路径穿越
  if (name === "." || name === "..") return false;
  
  // 禁止末尾点号（Windows限制）
  if (name.endsWith(".")) return false;
  
  // 禁止非法字符
  const invalidChars = ["/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\0"];
  return !invalidChars.some(c => name.includes(c));
};

/**
 * 验证路径名称是否合法
 * @param {string} name - 路径名称
 * @returns {boolean} 是否合法
 */
const isValidName = (name) => {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 255) return false;

  if (name === "." || name === "..") return false;
  if (name.endsWith(".")) return false;

  const invalidChars = ["/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\0"];
  return !invalidChars.some(c => name.includes(c));
};

/**
 * 安全边界检查 - 验证路径是否在授权根目录内
 * @param {string} resolvedPath - 解析后的路径
 * @returns {boolean} 是否在授权边界内
 */
const isUnderRoot = (resolvedPath) => {
  const abs = path.resolve(resolvedPath);

  for (const root of authorizedRoots) {
    if (abs === root || abs.startsWith(root + path.sep)) {
      return true;
    }
  }

  return false;
};

/**
 * 符号链接边界检查 - 防止符号链接指向授权范围外
 * @param {string} resolvedPath - 解析后的路径
 * @returns {boolean} 是否安全
 */
const checkSymlinkBoundary = (resolvedPath) => {
  try {
    // 使用 lstat 检查是否为符号链接
    const stat = fs.lstatSync(resolvedPath);
    
    if (stat.isSymbolicLink()) {
      // 解析真实路径
      const realPath = fs.realpathSync(resolvedPath);
      const absRealPath = path.resolve(realPath);
      
      // 验证真实路径是否在授权边界内
      if (!isUnderRoot(absRealPath)) {
        console.warn("[safe-io] Symlink points outside authorized roots:", realPath);
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
};

/**
 * 策略检查层（非安全核心）- 检查条目是否符合策略规则
 * @param {DirEntry|FileEntry|null} entry - 条目
 * @returns {boolean} 是否通过策略检查
 */
const policyCheck = (entry) => {
  if (!entry) return true;

  const name = entry.name || entry?.path?.at?.(-1);

  if (typeof name === "string" && name.startsWith(".")) {
    return true;
  }

  return true;
};

/**
 * 授权函数 - 执行完整的授权流程
 *
 * @param {BaseDir} base - BaseDir对象
 * @param {DirEntry|FileEntry|null} entry - Dir或File对象
 * @param {AuthorizeOptions} [options] - 可选配置
 * @returns {Object} Some({handle, token}) 或 None
 */
export const authorize = (base, entry, options = {}) => {
  try {
    if (authorizedRoots.size === 0) {
      console.warn("[safe-io] No authorized roots registered");
      return None();
    }

    const resolved = resolveEntry(base, entry);

    if (!isUnderRoot(resolved)) {
      console.warn("[safe-io] blocked root violation:", resolved);
      logAudit("authorize", resolved, false, { reason: "root violation" });
      return None();
    }

    if (!checkSymlinkBoundary(resolved)) {
      console.warn("[safe-io] symlink boundary violation:", resolved);
      logAudit("authorize", resolved, false, { reason: "symlink boundary violation" });
      return None();
    }

    if (!policyCheck(entry)) {
      console.warn("[safe-io] policy reject");
      logAudit("authorize", resolved, false, { reason: "policy reject" });
      return None();
    }

    let permissions = {};
    if (options.permissions) {
      permissions = options.permissions;
    } else if (options.preset) {
      permissions = getPresetPermissions(options.preset);
    }

    const handle = FileHandle(resolved, permissions);

    let token;
    if (options.preset) {
      token = createTokenWithPreset(resolved, options.preset);
    } else {
      token = createToken({
        path: resolved,
        permissions: handle.permissions || {},
      });
    }

    logAudit("authorize", resolved, true, {
      permissions: handle.permissions,
      preset: options.preset,
    });

    return Some({
      handle,
      token,
    });

  } catch (e) {
    console.error("[safe-io] authorize error:", e);
    logAudit("authorize", "", false, { reason: e.message });
    return None();
  }
};

/**
 * 根据预设名称获取权限配置
 * @param {string} preset - 预设名称
 * @returns {Object} 权限配置对象
 */
const getPresetPermissions = (preset) => {
  switch (preset) {
    case "READ_ONLY":
      return { read: true, write: false, rm: false, ls: true, hide: false, zip: false };
    case "READ_WRITE":
      return { read: true, write: true, rm: false, ls: true, hide: false, zip: true };
    case "FULL":
      return { read: true, write: true, rm: true, ls: true, hide: true, zip: true };
    default:
      return { read: true, write: false, rm: false, ls: true, hide: false, zip: false };
  }
};

/**
 * 获取所有授权根目录
 * @returns {string[]} 授权根目录数组
 */
export const getAuthorizedRoots = () => {
  return [...authorizedRoots];
};

/**
 * 检查路径是否在授权范围内
 * @param {string} p - 路径
 * @returns {boolean} 是否授权
 */
export const isPathAuthorized = (p) => {
  return isUnderRoot(p);
};