/**
 * @fileoverview Safe FS Runtime - 文件系统安全操作封装
 * @module safe-io/runtime/fs
 *
 * @description
 * 提供安全的文件系统操作，包括：
 * - 路径穿越防护
 * - 符号链接边界检查
 * - 文件大小限制
 * - 路径深度限制
 *
 * 设计原则：
 * - 不做权限判断（由上层处理）
 * - 不处理 DSL entry
 * - 不参与 capability
 * - 只处理 resolved path
 * - 所有错误吞掉并返回安全值
 *
 * @author safe-io Team
 * @version 3.0
 */

import fs from "fs";
import path from "path";
import { Hide } from "./hide.js";

/**
 * @typedef {Object} SymlinkInfo
 * @property {string} realPath - 真实路径
 * @property {boolean} isSymlink - 是否为符号链接
 * @property {boolean} isInBoundary - 是否在安全边界内
 */

/**
 * 路径安全检查结果
 * @typedef {Object|null} SafeResolveResult
 * @property {string|null} 解析后的路径，null表示不安全
 */

/**
 * 防止路径穿越攻击
 * @param {string} p - 路径
 * @returns {SafeResolveResult} 安全路径或null
 */
const safeResolve = (p) => {
  if (typeof p !== "string") return null;

  const normalized = path.normalize(p);

  if (normalized.includes("..")) return null;

  return normalized;
};

/**
 * 确保目录存在
 * @param {string} p - 文件路径
 * @returns {void}
 */
const ensureDir = (p) => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

/**
 * 安全执行包装器
 * @param {Function} fn - 要执行的函数
 * @param {*} fallback - 失败时的返回值
 * @param {string} [label="FS"] - 日志标签
 * @returns {*} 执行结果或fallback
 */
const safe = (fn, fallback = null, label = "FS") => {
  try {
    return fn();
  } catch (e) {
    console.error(`[${label}] Error occurred`);
    return fallback;
  }
};

/**
 * 符号链接安全检查
 * @param {string} p - 要检查的路径
 * @param {string} [boundary] - 可选的安全边界路径
 * @returns {SymlinkInfo|null} 符号链接信息或null（不安全）
 */
const checkSymlink = (p, boundary = null) => {
  try {
    const stat = fs.lstatSync(p);

    if (stat.isSymbolicLink()) {
      const realPath = fs.realpathSync(p);

      let isInBoundary = true;
      if (boundary) {
        const absBoundary = path.resolve(boundary);
        const absRealPath = path.resolve(realPath);
        isInBoundary = absRealPath === absBoundary || absRealPath.startsWith(absBoundary + path.sep);
      }

      return { realPath, isSymlink: true, isInBoundary };
    }

    let isInBoundary = true;
    if (boundary) {
      const absBoundary = path.resolve(boundary);
      const absPath = path.resolve(p);
      isInBoundary = absPath === absBoundary || absPath.startsWith(absBoundary + path.sep);
    }

    return { realPath: p, isSymlink: false, isInBoundary };
  } catch {
    return null;
  }
};

/**
 * 递归检查目录树中的符号链接
 * @param {string} dirPath - 目录路径
 * @param {string} [boundary] - 安全边界
 * @returns {boolean} 目录树是否安全
 */
const checkDirectorySymlinks = (dirPath, boundary = null) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      const symlinkInfo = checkSymlink(fullPath, boundary);
      if (!symlinkInfo || !symlinkInfo.isInBoundary) {
        return false;
      }

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (!checkDirectorySymlinks(fullPath, boundary)) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * 检查路径深度
 * @param {string} p - 路径
 * @param {number} [maxDepth=20] - 最大深度
 * @returns {boolean} 是否在限制内
 */
const checkPathDepth = (p, maxDepth = 20) => {
  const parts = p.split(path.sep).filter(Boolean);
  return parts.length <= maxDepth;
};

/**
 * 检查文件大小
 * @param {string} p - 文件路径
 * @param {number} [maxSize=100*1024*1024] - 最大大小（默认100MB）
 * @returns {boolean} 是否在限制内
 */
const checkFileSize = (p, maxSize = 100 * 1024 * 1024) => {
  try {
    const stat = fs.statSync(p);
    return stat.size <= maxSize;
  } catch {
    return false;
  }
};

/**
 * Safe FS API
 * @namespace FS
 */
export const FS = {
  /**
   * 读取文件
   * @param {string} p - 文件路径
   * @param {string} [encoding="utf8"] - 编码
   * @param {string} [boundary] - 安全边界
   * @returns {string|null} 文件内容或null
   */
  read: (p, encoding = "utf8", boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return null;

      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) {
        console.error("[FS.read] Symlink check failed");
        return null;
      }

      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.read] Path outside security boundary");
        return null;
      }

      const realPath = symlinkInfo.realPath;

      if (!fs.existsSync(realPath)) return null;

      if (!checkFileSize(realPath)) {
        console.error("[FS.read] File size exceeds limit");
        return null;
      }

      return fs.readFileSync(realPath, encoding);
    }, null, "FS.read"),

  /**
   * 写入文件
   * @param {string} p - 文件路径
   * @param {string} content - 内容
   * @param {string} [encoding="utf8"] - 编码
   * @param {string} [boundary] - 安全边界
   * @returns {boolean} 是否成功
   */
  write: (p, content, encoding = "utf8", boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      if (!checkPathDepth(sp)) {
        console.error("[FS.write] Path depth exceeds limit");
        return false;
      }

      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) {
        console.error("[FS.write] Symlink check failed");
        return false;
      }

      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.write] Path outside security boundary");
        return false;
      }

      if (symlinkInfo.isSymlink) {
        console.error("[FS.write] Cannot write to symlink");
        return false;
      }

      ensureDir(sp);

      const contentSize = Buffer.byteLength(content, encoding);
      if (contentSize > 100 * 1024 * 1024) {
        console.error("[FS.write] Content size exceeds limit");
        return false;
      }

      fs.writeFileSync(sp, content, encoding);
      return true;
    }, false, "FS.write"),

  /**
   * 删除文件或目录
   * @param {string} p - 路径
   * @param {string} [boundary] - 安全边界
   * @returns {boolean} 是否成功
   */
  rm: (p, boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) {
        console.error("[FS.rm] Symlink check failed");
        return false;
      }

      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.rm] Path outside security boundary");
        return false;
      }

      if (symlinkInfo.isSymlink) {
        fs.unlinkSync(sp);
        return true;
      }

      if (fs.existsSync(sp)) {
        fs.rmSync(sp, { recursive: true, force: true });
      }

      return true;
    }, false, "FS.rm"),

  /**
   * 检查文件是否存在
   * @param {string} p - 路径
   * @param {string} [boundary] - 安全边界
   * @returns {boolean} 是否存在
   */
  exists: (p, boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) return false;

      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.exists] Path outside security boundary");
        return false;
      }

      return fs.existsSync(symlinkInfo.realPath);
    }, false, "FS.exists"),

  /**
   * 列出目录内容
   * @param {string} p - 目录路径
   * @param {string} [boundary] - 安全边界
   * @returns {Array<{name: string, isDir: boolean, isFile: boolean, isSymlink: boolean, hidden: boolean}>} 目录条目
   */
  ls: (p, boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return [];

      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) return [];

      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.ls] Path outside security boundary");
        return [];
      }

      const realPath = symlinkInfo.realPath;

      return fs.readdirSync(realPath, { withFileTypes: true })
        .map(entry => ({
          name: entry.name,
          isDir: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymlink: entry.isSymbolicLink(),
          hidden: entry.name.startsWith("."),
        }));
    }, [], "FS.ls"),

  /**
   * 获取文件状态
   * @param {string} p - 路径
   * @param {string} [boundary] - 安全边界
   * @returns {Object|null} 文件状态信息
   */
  stat: (p, boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return null;

      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) return null;

      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.stat] Path outside security boundary");
        return null;
      }

      const stat = fs.statSync(symlinkInfo.realPath);
      return {
        ...stat,
        isSymlink: symlinkInfo.isSymlink,
        realPath: symlinkInfo.realPath,
      };
    }, null, "FS.stat"),

  /**
   * 复制文件或目录
   * @param {string} src - 源路径
   * @param {string} dest - 目标路径
   * @param {string} [boundary] - 安全边界
   * @returns {boolean} 是否成功
   */
  cp: (src, dest, boundary = null) =>
    safe(() => {
      const s = safeResolve(src);
      const d = safeResolve(dest);

      if (!s || !d) return false;

      const srcSymlink = checkSymlink(s, boundary);
      if (!srcSymlink) {
        console.error("[FS.cp] Source symlink check failed");
        return false;
      }

      if (!srcSymlink.isInBoundary) {
        console.error("[FS.cp] Source path outside security boundary");
        return false;
      }

      const destSymlink = checkSymlink(d, boundary);
      if (!destSymlink) {
        console.error("[FS.cp] Destination symlink check failed");
        return false;
      }

      if (!destSymlink.isInBoundary) {
        console.error("[FS.cp] Destination path outside security boundary");
        return false;
      }

      if (destSymlink.isSymlink) {
        console.error("[FS.cp] Cannot copy to symlink");
        return false;
      }

      ensureDir(d);

      fs.cpSync(srcSymlink.realPath, d, { recursive: true, force: true });
      return true;
    }, false, "FS.cp"),

  /**
   * 移动文件或目录
   * @param {string} src - 源路径
   * @param {string} dest - 目标路径
   * @param {string} [boundary] - 安全边界
   * @returns {boolean} 是否成功
   */
  mv: (src, dest, boundary = null) =>
    safe(() => {
      const s = safeResolve(src);
      const d = safeResolve(dest);

      if (!s || !d) return false;

      const srcSymlink = checkSymlink(s, boundary);
      if (!srcSymlink) {
        console.error("[FS.mv] Source symlink check failed");
        return false;
      }

      if (!srcSymlink.isInBoundary) {
        console.error("[FS.mv] Source path outside security boundary");
        return false;
      }

      const destSymlink = checkSymlink(d, boundary);
      if (!destSymlink) {
        console.error("[FS.mv] Destination symlink check failed");
        return false;
      }

      if (!destSymlink.isInBoundary) {
        console.error("[FS.mv] Destination path outside security boundary");
        return false;
      }

      if (destSymlink.isSymlink) {
        console.error("[FS.mv] Cannot move to symlink");
        return false;
      }

      ensureDir(d);

      fs.cpSync(srcSymlink.realPath, d, { recursive: true, force: true });
      fs.rmSync(srcSymlink.realPath, { recursive: true, force: true });

      return true;
    }, false, "FS.mv"),

  /**
   * 隐藏文件
   * @param {string} p - 路径
   * @returns {boolean} 是否成功
   */
  hide: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      const symlinkInfo = checkSymlink(sp);
      if (!symlinkInfo) return false;

      Hide.hide(symlinkInfo.realPath);
      return true;
    }, false, "FS.hide"),

  /**
   * 取消隐藏文件
   * @param {string} p - 路径
   * @returns {boolean} 是否成功
   */
  unhide: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      const symlinkInfo = checkSymlink(sp);
      if (!symlinkInfo) return false;

      Hide.unhide(symlinkInfo.realPath);
      return true;
    }, false, "FS.unhide"),

  /**
   * 检查文件是否隐藏
   * @param {string} p - 路径
   * @returns {boolean} 是否隐藏
   */
  isHidden: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      const symlinkInfo = checkSymlink(sp);
      if (!symlinkInfo) return false;

      return Hide.isHidden(symlinkInfo.realPath);
    }, false, "FS.isHidden"),

  /**
   * 获取真实路径（解析符号链接）
   * @param {string} p - 路径
   * @returns {string|null} 真实路径或null
   */
  realPath: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return null;
      return fs.realpathSync(sp);
    }, null, "FS.realPath"),
};