/**
 * @fileoverview FileHandle - Capability Handle与审计日志
 * @module safe-io/capability/handle
 *
 * @description
 * 提供：
 * - FileHandle 工厂函数
 * - 审计日志系统
 * - 动态权限管理
 * - 符号链接边界检查
 *
 * @author safe-io Team
 * @version 3.0
 */

import { FS } from "../runtime/fs.js";
import { Hide } from "../runtime/hide.js";
import { Zip } from "../runtime/zip.js";

/**
 * 审计日志条目
 * @typedef {Object} AuditEntry
 * @property {number} timestamp - 时间戳
 * @property {string} action - 操作类型
 * @property {string} path - 文件路径
 * @property {boolean} success - 是否成功
 * @property {Object} [details] - 附加详情
 */

/**
 * 全局审计日志
 * @type {AuditEntry[]}
 */
export const auditLog = [];

/**
 * 最大审计日志条目数
 * @type {number}
 */
const MAX_AUDIT_ENTRIES = 1000;

/**
 * 记录审计日志
 * @param {string} action - 操作类型
 * @param {string} path - 文件路径
 * @param {boolean} success - 是否成功
 * @param {Object} [details] - 附加详情
 * @returns {void}
 */
export const logAudit = (action, path, success, details = {}) => {
  const entry = {
    timestamp: Date.now(),
    action,
    path,
    success,
    ...details,
  };

  auditLog.push(entry);

  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.shift();
  }
};

/**
 * 检查路径是否在授权边界内
 * @param {string} resolvedPath - 解析后的路径
 * @param {string} realPath - 真实路径
 * @returns {boolean} 是否在边界内
 */
const isPathInBoundary = (resolvedPath, realPath) => {
  if (!resolvedPath || !realPath) return false;
  return realPath === resolvedPath || realPath.startsWith(resolvedPath + "/");
};

/**
 * 权限管理器
 * @namespace PermissionManager
 */
export const PermissionManager = {
  /**
   * 权限名称定义
   * @type {Object}
   */
  PERMISSIONS: {
    READ: "read",
    WRITE: "write",
    RM: "rm",
    LS: "ls",
    HIDE: "hide",
    ZIP: "zip",
  },

  /**
   * 默认权限配置
   * @type {Object}
   */
  DEFAULT: {
    read: true,
    write: false,
    rm: false,
    ls: true,
    hide: false,
    zip: true,
  },

  /**
   * 权限预设配置
   * @type {Object}
   */
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

  /**
   * 验证权限
   * @param {Object} permissions - 权限对象
   * @param {string} required - 需要的权限
   * @returns {boolean} 是否有权限
   */
  check: (permissions, required) => {
    if (!permissions) return false;
    return permissions[required] === true;
  },

  /**
   * 合并权限
   * @param {Object} base - 基础权限
   * @param {Object} overrides - 覆盖权限
   * @returns {Object} 合并后的权限
   */
  merge: (base, overrides) => {
    return { ...base, ...overrides };
  },

  /**
   * 克隆权限
   * @param {Object} permissions - 权限对象
   * @returns {Object} 克隆后的权限
   */
  clone: (permissions) => {
    return { ...permissions };
  },
};

/**
 * FileHandle 工厂函数
 * @param {string} resolvedPath - 解析后的文件路径
 * @param {Object} [permissions={}] - 权限配置
 * @returns {Object} FileHandle对象
 */
export const FileHandle = (resolvedPath, permissions = {}) => {
  let revoked = false;
  /** @type {AuditEntry[]} */
  const auditHistory = [];

  const perm = PermissionManager.merge(
    PermissionManager.DEFAULT,
    permissions
  );

  /**
   * 记录到实例历史
   * @param {string} action - 操作类型
   * @param {boolean} success - 是否成功
   * @param {Object} [details] - 附加详情
   * @returns {void}
   */
  const logToHistory = (action, success, details = {}) => {
    const entry = {
      timestamp: Date.now(),
      action,
      path: resolvedPath,
      success,
      ...details,
    };
    auditHistory.push(entry);

    if (auditHistory.length > 100) {
      auditHistory.shift();
    }
  };

  /**
   * 撤销检查
   * @returns {void}
   * @throws {Error} handle已撤销
   */
  const check = () => {
    if (revoked) {
      const reason = "handle revoked";
      logAudit("access_denied", resolvedPath, false, { reason });
      logToHistory("access_denied", false, { reason });
      throw new Error("[safe-io] handle revoked");
    }
  };

  /**
   * 符号链接边界检查
   * @param {string} pathToCheck - 要检查的路径
   * @returns {boolean} 是否安全
   */
  const checkSymlinkBoundary = (pathToCheck) => {
    const realPath = FS.realPath(pathToCheck);
    if (!realPath) {
      return false;
    }

    const canonicalResolvedPath = FS.realPath(resolvedPath) || resolvedPath;
    return isPathInBoundary(canonicalResolvedPath, realPath);
  };

  /**
   * 读取文件
   * @returns {string|null} 文件内容
   */
  const read = () => {
    check();
    if (!PermissionManager.check(perm, "read")) {
      const reason = "permission denied";
      logAudit("read", resolvedPath, false, { reason });
      logToHistory("read", false, { reason });
      return null;
    }

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

  /**
   * 写入文件
   * @param {string} content - 文件内容
   * @returns {boolean} 是否成功
   */
  const write = (content) => {
    check();
    if (!PermissionManager.check(perm, "write")) {
      const reason = "permission denied";
      logAudit("write", resolvedPath, false, { reason });
      logToHistory("write", false, { reason });
      return false;
    }

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

  /**
   * 删除文件
   * @returns {boolean} 是否成功
   */
  const rm = () => {
    check();
    if (!PermissionManager.check(perm, "rm")) {
      const reason = "permission denied";
      logAudit("rm", resolvedPath, false, { reason });
      logToHistory("rm", false, { reason });
      return false;
    }

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

  /**
   * 列出目录
   * @returns {Array} 目录条目
   */
  const ls = () => {
    check();
    if (!PermissionManager.check(perm, "ls")) {
      const reason = "permission denied";
      logAudit("ls", resolvedPath, false, { reason });
      logToHistory("ls", false, { reason });
      return [];
    }

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

  /**
   * 隐藏文件
   * @returns {boolean} 是否成功
   */
  const hide = () => {
    check();
    if (!PermissionManager.check(perm, "hide")) {
      const reason = "permission denied";
      logAudit("hide", resolvedPath, false, { reason });
      logToHistory("hide", false, { reason });
      return false;
    }

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

  /**
   * 取消隐藏
   * @returns {boolean} 是否成功
   */
  const unhide = () => {
    check();
    if (!PermissionManager.check(perm, "hide")) {
      const reason = "permission denied";
      logAudit("unhide", resolvedPath, false, { reason });
      logToHistory("unhide", false, { reason });
      return false;
    }

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

  /**
   * 压缩文件/目录
   * @param {string} out - 输出路径
   * @returns {boolean} 是否成功
   */
  const zip = (out) => {
    check();
    if (!PermissionManager.check(perm, "zip")) {
      const reason = "permission denied";
      logAudit("zip", resolvedPath, false, { reason });
      logToHistory("zip", false, { reason });
      return false;
    }

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

  /**
   * 解压缩
   * @param {string} target - 目标目录
   * @returns {boolean} 是否成功
   */
  const unzipTo = (target) => {
    check();
    if (!PermissionManager.check(perm, "zip")) {
      const reason = "permission denied";
      logAudit("unzipTo", resolvedPath, false, { reason });
      logToHistory("unzipTo", false, { reason });
      return false;
    }

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

  /**
   * 检查文件是否存在
   * @returns {boolean} 是否存在
   */
  const exists = () => {
    check();
    const result = FS.exists(resolvedPath);
    logAudit("exists", resolvedPath, result);
    logToHistory("exists", result);
    return result;
  };

  /**
   * 更新权限
   * @param {Object} newPermissions - 新权限
   * @returns {boolean} 是否成功
   */
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

  /**
   * 授予权限
   * @param {string} permission - 权限名称
   * @returns {boolean} 是否成功
   */
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

  /**
   * 撤销权限
   * @param {string} permission - 权限名称
   * @returns {boolean} 是否成功
   */
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

  /**
   * 撤销当前 handle
   * @returns {boolean} 是否成功
   */
  const revoke = () => {
    if (revoked) {
      return true;
    }

    revoked = true;
    logAudit("revoke", resolvedPath, true);
    logToHistory("revoke", true);
    return true;
  };

  /**
   * 获取审计历史
   * @returns {AuditEntry[]} 审计历史副本
   */
  const getAuditHistory = () => {
    check();
    return [...auditHistory];
  };

  /**
   * 获取全局审计日志副本
   * @returns {AuditEntry[]} 审计日志副本
   */
  const getAuditLog = () => {
    return [...auditLog];
  };

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

    revoke,
    isRevoked: () => revoked,
    updatePermissions,
    grantPermission,
    revokePermission,

    getAuditHistory,
    getAuditLog,
  });
};