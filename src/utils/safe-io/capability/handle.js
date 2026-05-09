import { FS } from "../runtime/fs.js";
import { Hide } from "../runtime/hide.js";
import { Zip } from "../runtime/zip.js";

// ==============================
// 🔐 AUDIT LOG
// ==============================

const auditLog = [];
const MAX_AUDIT_ENTRIES = 1000;

export const logAudit = (action, path, success, details = {}) => {
  const entry = {
    timestamp: Date.now(),
    action,
    path,
    success,
    ...details,
  };
  
  auditLog.push(entry);
  
  // 限制日志大小
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.shift();
  }
  
  // 可以发送到远程日志服务
  // console.debug("[safe-io] Audit:", entry);
};

// ==============================
// 🔐 SECURITY BOUNDARY CHECK
// ==============================

/**
 * 检查路径是否在授权边界内
 * 防止符号链接穿越到授权范围之外
 */
const isPathInBoundary = (resolvedPath, realPath) => {
  if (!resolvedPath || !realPath) return false;
  
  // 真实路径必须以授权路径开头或相等
  return realPath === resolvedPath || realPath.startsWith(resolvedPath + "/");
};

// ==============================
// 🔐 PERMISSION MANAGER
// ==============================

export const PermissionManager = {
  // 权限定义
  PERMISSIONS: {
    READ: "read",
    WRITE: "write",
    RM: "rm",
    LS: "ls",
    HIDE: "hide",
    ZIP: "zip",
  },

  // 默认权限
  DEFAULT: {
    read: true,
    write: false,
    rm: false,
    ls: true,
    hide: false,
    zip: true,
  },

  // 权限组合
  PRESETS: {
    READ_ONLY: {
      read: true,
      write: false,
      rm: false,
      ls: true,
      hide: false,
      zip: false,
    },
    READ_WRITE: {
      read: true,
      write: true,
      rm: false,
      ls: true,
      hide: false,
      zip: true,
    },
    FULL: {
      read: true,
      write: true,
      rm: true,
      ls: true,
      hide: true,
      zip: true,
    },
  },

  // 验证权限
  check: (permissions, required) => {
    if (!permissions) return false;
    return permissions[required] === true;
  },

  // 合并权限
  merge: (base, overrides) => {
    return { ...base, ...overrides };
  },

  // 克隆权限
  clone: (permissions) => {
    return { ...permissions };
  },
};

// ==============================
// 🔐 FILE HANDLE
// ==============================

export const FileHandle = (resolvedPath, permissions = {}) => {
  let revoked = false;
  const auditHistory = [];

  const perm = PermissionManager.merge(
    PermissionManager.DEFAULT,
    permissions
  );

  // ==========================
  // 📝 Instance-level audit logger
  // ==========================

  const logToHistory = (action, success, details = {}) => {
    const entry = {
      timestamp: Date.now(),
      action,
      path: resolvedPath,
      success,
      ...details,
    };
    auditHistory.push(entry);
    
    // 限制实例历史大小
    if (auditHistory.length > 100) {
      auditHistory.shift();
    }
  };

  // ==========================
  // 🔒 revoke control
  // ==========================

  const revoke = () => {
    revoked = true;
    logAudit("revoke", resolvedPath, true);
    logToHistory("revoke", true);
  };

  const check = () => {
    if (revoked) {
      const reason = "handle revoked";
      logAudit("access_denied", resolvedPath, false, { reason });
      logToHistory("access_denied", false, { reason });
      throw new Error("[safe-io] handle revoked");
    }
  };

  // ==========================
  // 🔐 Symlink boundary check
  // ==========================

  const checkSymlinkBoundary = (pathToCheck) => {
    const realPath = FS.realPath(pathToCheck);
    if (!realPath) {
      return false;
    }
    return isPathInBoundary(resolvedPath, realPath);
  };

  // ==========================
  // 📖 read
  // ==========================
  const read = () => {
    check();
    if (!PermissionManager.check(perm, "read")) {
      const reason = "permission denied";
      logAudit("read", resolvedPath, false, { reason });
      logToHistory("read", false, { reason });
      return null;
    }
    
    // 符号链接边界检查
    if (!checkSymlinkBoundary(resolvedPath)) {
      const reason = "symlink boundary violation";
      logAudit("read", resolvedPath, false, { reason });
      logToHistory("read", false, { reason });
      return null;
    }
    
    const result = FS.read(resolvedPath);
    logAudit("read", resolvedPath, result !== null);
    logToHistory("read", result !== null);
    return result;
  };

  // ==========================
  // ✍ write
  // ==========================
  const write = (content) => {
    check();
    if (!PermissionManager.check(perm, "write")) {
      const reason = "permission denied";
      logAudit("write", resolvedPath, false, { reason });
      logToHistory("write", false, { reason });
      return false;
    }
    
    // 符号链接边界检查
    if (!checkSymlinkBoundary(resolvedPath)) {
      const reason = "symlink boundary violation";
      logAudit("write", resolvedPath, false, { reason });
      logToHistory("write", false, { reason });
      return false;
    }
    
    const result = FS.write(resolvedPath, content);
    logAudit("write", resolvedPath, result);
    logToHistory("write", result);
    return result;
  };

  // ==========================
  // ❌ rm
  // ==========================
  const rm = () => {
    check();
    if (!PermissionManager.check(perm, "rm")) {
      const reason = "permission denied";
      logAudit("rm", resolvedPath, false, { reason });
      logToHistory("rm", false, { reason });
      return false;
    }
    
    // 符号链接边界检查
    if (!checkSymlinkBoundary(resolvedPath)) {
      const reason = "symlink boundary violation";
      logAudit("rm", resolvedPath, false, { reason });
      logToHistory("rm", false, { reason });
      return false;
    }
    
    const result = FS.rm(resolvedPath);
    logAudit("rm", resolvedPath, result);
    logToHistory("rm", result);
    return result;
  };

  // ==========================
  // 📂 ls
  // ==========================
  const ls = () => {
    check();
    if (!PermissionManager.check(perm, "ls")) {
      const reason = "permission denied";
      logAudit("ls", resolvedPath, false, { reason });
      logToHistory("ls", false, { reason });
      return [];
    }
    
    // 符号链接边界检查
    if (!checkSymlinkBoundary(resolvedPath)) {
      const reason = "symlink boundary violation";
      logAudit("ls", resolvedPath, false, { reason });
      logToHistory("ls", false, { reason });
      return [];
    }
    
    const result = FS.ls(resolvedPath);
    logAudit("ls", resolvedPath, true);
    logToHistory("ls", true);
    return result;
  };

  // ==========================
  // 👁 hide
  // ==========================
  const hide = () => {
    check();
    if (!PermissionManager.check(perm, "hide")) {
      const reason = "permission denied";
      logAudit("hide", resolvedPath, false, { reason });
      logToHistory("hide", false, { reason });
      return false;
    }
    
    // 符号链接边界检查
    if (!checkSymlinkBoundary(resolvedPath)) {
      const reason = "symlink boundary violation";
      logAudit("hide", resolvedPath, false, { reason });
      logToHistory("hide", false, { reason });
      return false;
    }
    
    const result = Hide.hide(resolvedPath);
    logAudit("hide", resolvedPath, result);
    logToHistory("hide", result);
    return result;
  };

  const unhide = () => {
    check();
    if (!PermissionManager.check(perm, "hide")) {
      const reason = "permission denied";
      logAudit("unhide", resolvedPath, false, { reason });
      logToHistory("unhide", false, { reason });
      return false;
    }
    
    // 符号链接边界检查
    if (!checkSymlinkBoundary(resolvedPath)) {
      const reason = "symlink boundary violation";
      logAudit("unhide", resolvedPath, false, { reason });
      logToHistory("unhide", false, { reason });
      return false;
    }
    
    const result = Hide.unhide(resolvedPath);
    logAudit("unhide", resolvedPath, result);
    logToHistory("unhide", result);
    return result;
  };

  // ==========================
  // 📦 zip
  // ==========================
  const zip = (out) => {
    check();
    if (!PermissionManager.check(perm, "zip")) {
      const reason = "permission denied";
      logAudit("zip", resolvedPath, false, { reason });
      logToHistory("zip", false, { reason });
      return false;
    }
    
    // 符号链接边界检查
    if (!checkSymlinkBoundary(resolvedPath)) {
      const reason = "symlink boundary violation";
      logAudit("zip", resolvedPath, false, { reason });
      logToHistory("zip", false, { reason });
      return false;
    }
    
    const result = Zip.fromFolder(resolvedPath, out);
    logAudit("zip", resolvedPath, result, { output: out });
    logToHistory("zip", result, { output: out });
    return result;
  };

  const unzipTo = (target) => {
    check();
    if (!PermissionManager.check(perm, "zip")) {
      const reason = "permission denied";
      logAudit("unzipTo", resolvedPath, false, { reason });
      logToHistory("unzipTo", false, { reason });
      return false;
    }
    
    // 符号链接边界检查
    if (!checkSymlinkBoundary(resolvedPath)) {
      const reason = "symlink boundary violation";
      logAudit("unzipTo", resolvedPath, false, { reason });
      logToHistory("unzipTo", false, { reason });
      return false;
    }
    
    const result = Zip.extractTo(resolvedPath, target);
    logAudit("unzipTo", resolvedPath, result, { target });
    logToHistory("unzipTo", result, { target });
    return result;
  };

  // ==========================
  // 📌 metadata
  // ==========================
  const exists = () => {
    check();
    const result = FS.exists(resolvedPath);
    logAudit("exists", resolvedPath, result);
    logToHistory("exists", result);
    return result;
  };

  // ==========================
  // 🔐 NEW: Dynamic Permission Management
  // ==========================

  const updatePermissions = (newPermissions) => {
    check();
    const oldPermissions = { ...perm };
    Object.assign(perm, newPermissions);
    
    logAudit("update_permissions", resolvedPath, true, {
      old: oldPermissions,
      new: { ...perm },
    });
    logToHistory("update_permissions", true, {
      old: oldPermissions,
      new: { ...perm },
    });
    
    return true;
  };

  const grantPermission = (permission) => {
    check();
    if (PermissionManager.PERMISSIONS[permission.toUpperCase()]) {
      perm[permission] = true;
      logAudit("grant_permission", resolvedPath, true, { permission });
      logToHistory("grant_permission", true, { permission });
      return true;
    }
    return false;
  };

  const revokePermission = (permission) => {
    check();
    if (PermissionManager.PERMISSIONS[permission.toUpperCase()]) {
      perm[permission] = false;
      logAudit("revoke_permission", resolvedPath, true, { permission });
      logToHistory("revoke_permission", true, { permission });
      return true;
    }
    return false;
  };

  // ==========================
  // 🔐 NEW: Audit & Monitoring
  // ==========================

  const getAuditHistory = () => {
    check();
    return [...auditHistory];
  };

  const getAuditLog = () => {
    // 返回全局审计日志的副本
    return [...auditLog];
  };

  // ==========================
  // 🔐 public API
  // ==========================
  return Object.freeze({
    path: resolvedPath,
    permissions: Object.freeze({ ...perm }),

    read,
    write,
    rm,
    ls,

    hide,
    unhide,

    zip,
    unzipTo,

    exists,

    // 🔥 NEW: Permission Management
    revoke,
    isRevoked: () => revoked,
    updatePermissions,
    grantPermission,
    revokePermission,

    // 🔥 NEW: Audit
    getAuditHistory,
    getAuditLog,
  });
};

// ==============================
// 🔐 EXPORTS
// ==============================

export { auditLog };
