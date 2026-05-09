import path from "path";
import fs from "fs";

import { Some, None } from "../functional.js";
import { FileHandle } from "../capability/handle.js";
import { createToken, createTokenWithPreset } from "../capability/token.js";
import { logAudit } from "../capability/handle.js";

/**
 * safe-io-v3 authorize layer
 * --------------------------
 * 核心职责：
 * 1. 解析 entry → resolved path
 * 2. root security boundary check
 * 3. 符号链接安全检查（防止路径穿越）
 * 4. policy check（非安全核心）
 * 5. 生成 FileHandle
 * 6. 生成 signed capability token（IPC用）
 */

// ==============================
// 🔐 Authorized roots
// ==============================

const authorizedRoots = new Set();

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

export const clearRoots = () => {
  authorizedRoots.clear();
  logAudit("clear_roots", "", true);
};

// ==============================
// 🔎 Path resolution
// ==============================

const resolveEntry = (base, entry) => {
  // 验证 base 结构
  if (!base || !base.segments || !Array.isArray(base.segments)) {
    throw new Error("Invalid base directory structure");
  }

  const basePath = path.resolve(...base.segments);

  // 验证 basePath 是否在授权范围内
  if (!isUnderRoot(basePath)) {
    throw new Error("Base path outside authorized roots");
  }

  if (!entry) return basePath;

  // 验证 entry 类型
  if (!entry.__type) {
    throw new Error("Entry missing __type");
  }

  if (entry.__type === "Dir") {
    // 验证目录名称
    if (!isValidName(entry.name)) {
      throw new Error(`Invalid directory name: ${entry.name}`);
    }
    return path.join(basePath, entry.name);
  }

  if (entry.__type === "File") {
    // 验证文件名
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

// ==============================
// 🧠 路径名称验证
// ==============================

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

// ==============================
// 🧠 Security boundary check
// ==============================

const isUnderRoot = (resolvedPath) => {
  const abs = path.resolve(resolvedPath);

  for (const root of authorizedRoots) {
    if (abs === root || abs.startsWith(root + path.sep)) {
      return true;
    }
  }

  return false;
};

// ==============================
// � Symlink boundary check
// ==============================

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

// ==============================
// �👁 policy layer (NOT security layer)
// ==============================

const policyCheck = (entry) => {
  if (!entry) return true;

  const name = entry.name || entry?.path?.at?.(-1);

  // dotfiles are allowed (no security meaning)
  if (typeof name === "string" && name.startsWith(".")) {
    return true;
  }

  return true;
};

// ==============================
// ⚙️ MAIN AUTHORIZE FUNCTION
// ==============================

/**
 * authorize(base, entry, options)
 *
 * @param {Object} base - BaseDir 对象
 * @param {Object} entry - Dir 或 File 对象
 * @param {Object} [options] - 可选配置
 * @param {string} [options.preset] - 权限预设：'READ_ONLY', 'READ_WRITE', 'FULL'
 * @param {Object} [options.permissions] - 自定义权限对象
 *
 * 返回：
 * {
 *   handle,
 *   token
 * }
 */
export const authorize = (base, entry, options = {}) => {
  try {
    // 1. 验证授权根目录是否存在
    if (authorizedRoots.size === 0) {
      console.warn("[safe-io] No authorized roots registered");
      return None();
    }

    // 2. 解析路径
    const resolved = resolveEntry(base, entry);

    // 3. root check (HARD BOUNDARY)
    if (!isUnderRoot(resolved)) {
      console.warn("[safe-io] blocked root violation:", resolved);
      logAudit("authorize", resolved, false, { reason: "root violation" });
      return None();
    }

    // 4. 符号链接边界检查
    if (!checkSymlinkBoundary(resolved)) {
      console.warn("[safe-io] symlink boundary violation:", resolved);
      logAudit("authorize", resolved, false, { reason: "symlink boundary violation" });
      return None();
    }

    // 5. policy layer (soft rules)
    if (!policyCheck(entry)) {
      console.warn("[safe-io] policy reject");
      logAudit("authorize", resolved, false, { reason: "policy reject" });
      return None();
    }

    // 6. 创建权限配置
    let permissions = {};
    if (options.permissions) {
      permissions = options.permissions;
    } else if (options.preset) {
      // 使用预设权限（将在 token 层转换为 bitmask）
      permissions = getPresetPermissions(options.preset);
    }

    // 7. create capability handle
    const handle = FileHandle(resolved, permissions);

    // 8. create signed IPC token
    let token;
    if (options.preset) {
      token = createTokenWithPreset(resolved, options.preset);
    } else {
      token = createToken({
        path: resolved,
        permissions: handle.permissions || {},
      });
    }

    // 9. 记录审计日志
    logAudit("authorize", resolved, true, {
      permissions: handle.permissions,
      preset: options.preset,
    });

    // 10. return capability bundle
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

// ==============================
// 🧠 权限预设映射
// ==============================

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

// ==============================
// 📊 辅助函数
// ==============================

/**
 * 获取所有授权根目录
 */
export const getAuthorizedRoots = () => {
  return [...authorizedRoots];
};

/**
 * 检查路径是否在授权范围内
 */
export const isPathAuthorized = (p) => {
  return isUnderRoot(p);
};