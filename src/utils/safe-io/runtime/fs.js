import fs from "fs";
import path from "path";
import { Hide } from "./hide.js";

// ==============================
// 🧠 INTERNAL HELPERS
// ==============================

/**
 * 防止路径穿越攻击
 */
const safeResolve = (p) => {
  if (typeof p !== "string") return null;

  const normalized = path.normalize(p);

  // 禁止路径穿越
  if (normalized.includes("..")) return null;

  return normalized;
};

/**
 * 确保目录存在
 */
const ensureDir = (p) => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

/**
 * safe wrapper
 */
const safe = (fn, fallback = null, label = "FS") => {
  try {
    return fn();
  } catch (e) {
    // 生产环境隐藏详细错误信息
    console.error(`[${label}] Error occurred`);
    return fallback;
  }
};

/**
 * 符号链接安全检查
 * @param {string} p - 要检查的路径
 * @param {string} [boundary] - 可选的安全边界路径
 * @returns {Object|null} { realPath, isSymlink, isInBoundary } 或 null（如果不安全）
 */
const checkSymlink = (p, boundary = null) => {
  try {
    // 使用 lstat 获取原始文件信息（不跟随符号链接）
    const stat = fs.lstatSync(p);
    
    if (stat.isSymbolicLink()) {
      // 符号链接：解析真实路径
      const realPath = fs.realpathSync(p);
      
      // 检查真实路径是否在安全边界内
      let isInBoundary = true;
      if (boundary) {
        const absBoundary = path.resolve(boundary);
        const absRealPath = path.resolve(realPath);
        isInBoundary = absRealPath === absBoundary || absRealPath.startsWith(absBoundary + path.sep);
      }
      
      return { realPath, isSymlink: true, isInBoundary };
    }
    
    // 非符号链接：检查是否在边界内（如果提供了边界）
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
 * 防止目录遍历攻击
 * @param {string} dirPath - 目录路径
 * @param {string} [boundary] - 安全边界
 * @returns {boolean} - 如果目录树安全返回 true
 */
const checkDirectorySymlinks = (dirPath, boundary = null) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      // 检查当前条目
      const symlinkInfo = checkSymlink(fullPath, boundary);
      if (!symlinkInfo || !symlinkInfo.isInBoundary) {
        return false;
      }
      
      // 如果是目录，递归检查
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
 * 路径深度限制检查
 */
const checkPathDepth = (p, maxDepth = 20) => {
  const parts = p.split(path.sep).filter(Boolean);
  return parts.length <= maxDepth;
};

/**
 * 文件大小限制检查
 */
const checkFileSize = (p, maxSize = 100 * 1024 * 1024) => {
  try {
    const stat = fs.statSync(p);
    return stat.size <= maxSize;
  } catch {
    return false;
  }
};

// ==============================
// 📁 SAFE FS CORE LAYER
// ==============================

export const FS = {
  // ============================
  // 📖 READ
  // ============================
  read: (p, encoding = "utf8", boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return null;

      // 符号链接检查（带边界验证）
      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) {
        console.error("[FS.read] Symlink check failed");
        return null;
      }
      
      // 检查真实路径是否在安全边界内
      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.read] Path outside security boundary");
        return null;
      }
      
      // 使用真实路径
      const realPath = symlinkInfo.realPath;

      if (!fs.existsSync(realPath)) return null;

      // 文件大小限制（100MB）
      if (!checkFileSize(realPath)) {
        console.error("[FS.read] File size exceeds limit");
        return null;
      }

      return fs.readFileSync(realPath, encoding);
    }, null, "FS.read"),

  // ============================
  // ✍ WRITE
  // ============================
  write: (p, content, encoding = "utf8", boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      // 路径深度限制
      if (!checkPathDepth(sp)) {
        console.error("[FS.write] Path depth exceeds limit");
        return false;
      }

      // 符号链接检查 - 写入时禁止覆盖符号链接目标
      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) {
        console.error("[FS.write] Symlink check failed");
        return false;
      }
      
      // 检查是否在安全边界内
      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.write] Path outside security boundary");
        return false;
      }

      // 禁止写入符号链接
      if (symlinkInfo.isSymlink) {
        console.error("[FS.write] Cannot write to symlink");
        return false;
      }

      ensureDir(sp);

      // 内容大小限制（100MB）
      const contentSize = Buffer.byteLength(content, encoding);
      if (contentSize > 100 * 1024 * 1024) {
        console.error("[FS.write] Content size exceeds limit");
        return false;
      }

      fs.writeFileSync(sp, content, encoding);
      return true;
    }, false, "FS.write"),

  // ============================
  // ❌ REMOVE
  // ============================
  rm: (p, boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      // 符号链接检查
      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) {
        console.error("[FS.rm] Symlink check failed");
        return false;
      }
      
      // 检查是否在安全边界内
      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.rm] Path outside security boundary");
        return false;
      }

      // 删除时只删除符号链接本身，不跟随
      if (symlinkInfo.isSymlink) {
        fs.unlinkSync(sp);
        return true;
      }

      if (fs.existsSync(sp)) {
        fs.rmSync(sp, { recursive: true, force: true });
      }

      return true;
    }, false, "FS.rm"),

  // ============================
  // 📂 EXISTS
  // ============================
  exists: (p, boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      // 符号链接检查（带边界验证）
      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) return false;
      
      // 检查是否在安全边界内
      if (!symlinkInfo.isInBoundary) {
        console.error("[FS.exists] Path outside security boundary");
        return false;
      }

      return fs.existsSync(symlinkInfo.realPath);
    }, false, "FS.exists"),

  // ============================
  // 📃 LIST DIRECTORY
  // ============================
  ls: (p, boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return [];

      // 符号链接检查（带边界验证）
      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) return [];
      
      // 检查是否在安全边界内
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

  // ============================
  // 📦 STAT
  // ============================
  stat: (p, boundary = null) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return null;

      // 符号链接检查（带边界验证）
      const symlinkInfo = checkSymlink(sp, boundary);
      if (!symlinkInfo) return null;
      
      // 检查是否在安全边界内
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

  // ============================
  // 🔁 COPY
  // ============================
  cp: (src, dest, boundary = null) =>
    safe(() => {
      const s = safeResolve(src);
      const d = safeResolve(dest);

      if (!s || !d) return false;

      // 符号链接检查 - 复制时解析符号链接
      const srcSymlink = checkSymlink(s, boundary);
      if (!srcSymlink) {
        console.error("[FS.cp] Source symlink check failed");
        return false;
      }
      
      // 检查源路径是否在安全边界内
      if (!srcSymlink.isInBoundary) {
        console.error("[FS.cp] Source path outside security boundary");
        return false;
      }

      // 目标路径检查
      const destSymlink = checkSymlink(d, boundary);
      if (!destSymlink) {
        console.error("[FS.cp] Destination symlink check failed");
        return false;
      }
      
      // 检查目标路径是否在安全边界内
      if (!destSymlink.isInBoundary) {
        console.error("[FS.cp] Destination path outside security boundary");
        return false;
      }

      // 禁止复制到符号链接
      if (destSymlink.isSymlink) {
        console.error("[FS.cp] Cannot copy to symlink");
        return false;
      }

      // 确保目标目录存在
      ensureDir(d);

      fs.cpSync(srcSymlink.realPath, d, { recursive: true, force: true });
      return true;
    }, false, "FS.cp"),

  // ============================
  // 🔁 MOVE
  // ============================
  mv: (src, dest, boundary = null) =>
    safe(() => {
      const s = safeResolve(src);
      const d = safeResolve(dest);

      if (!s || !d) return false;

      // 符号链接检查
      const srcSymlink = checkSymlink(s, boundary);
      if (!srcSymlink) {
        console.error("[FS.mv] Source symlink check failed");
        return false;
      }
      
      // 检查源路径是否在安全边界内
      if (!srcSymlink.isInBoundary) {
        console.error("[FS.mv] Source path outside security boundary");
        return false;
      }

      const destSymlink = checkSymlink(d, boundary);
      if (!destSymlink) {
        console.error("[FS.mv] Destination symlink check failed");
        return false;
      }
      
      // 检查目标路径是否在安全边界内
      if (!destSymlink.isInBoundary) {
        console.error("[FS.mv] Destination path outside security boundary");
        return false;
      }

      // 禁止移动到符号链接
      if (destSymlink.isSymlink) {
        console.error("[FS.mv] Cannot move to symlink");
        return false;
      }

      // 确保目标目录存在
      ensureDir(d);

      fs.cpSync(srcSymlink.realPath, d, { recursive: true, force: true });
      fs.rmSync(srcSymlink.realPath, { recursive: true, force: true });

      return true;
    }, false, "FS.mv"),

  // ============================
  // 👁 HIDE LAYER (external capability)
  // ============================
  hide: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      // 符号链接检查
      const symlinkInfo = checkSymlink(sp);
      if (!symlinkInfo) return false;

      Hide.hide(symlinkInfo.realPath);
      return true;
    }, false, "FS.hide"),

  unhide: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      // 符号链接检查
      const symlinkInfo = checkSymlink(sp);
      if (!symlinkInfo) return false;

      Hide.unhide(symlinkInfo.realPath);
      return true;
    }, false, "FS.unhide"),

  isHidden: (p) =>
    safe(() => {
      const sp = safeResolve(p);
      if (!sp) return false;

      // 符号链接检查
      const symlinkInfo = checkSymlink(sp);
      if (!symlinkInfo) return false;

      return Hide.isHidden(symlinkInfo.realPath);
    }, false, "FS.isHidden"),

  // ============================
  // 🔐 NEW: Security Helpers
  // ============================
  
  /**
   * 检查路径是否安全（无符号链接穿越）
   */
  isPathSafe: (p) => {
    const sp = safeResolve(p);
    if (!sp) return false;

    const symlinkInfo = checkSymlink(sp);
    if (!symlinkInfo) return false;

    // 可以添加更多安全检查
    return true;
  },

  /**
   * 获取真实路径（解析符号链接）
   */
  realPath: (p) => {
    const sp = safeResolve(p);
    if (!sp) return null;

    const symlinkInfo = checkSymlink(sp);
    return symlinkInfo ? symlinkInfo.realPath : null;
  },
};
