/**
 * @fileoverview Permission Layer - Bitmask权限系统
 * @module safe-io/auth/permission
 *
 * @description
 * 作用：
 * 1. 定义 bitmask 权限
 * 2. 提供权限判断
 * 3. 将 IPC 操作映射为权限
 * 4. 提供统一 enforcement 接口
 *
 * @author safe-io Team
 * @version 3.0
 */

/**
 * Bitmask 权限定义
 * @readonly
 * @enum {number}
 */
export const Permission = {
  READ: 1 << 0,
  WRITE: 1 << 1,
  DELETE: 1 << 2,
  MKDIR: 1 << 3,
  ZIP: 1 << 4,
  UNZIP: 1 << 5,
  HIDE: 1 << 6,
};

/**
 * 判断token是否拥有指定权限
 * @param {number} tokenPermissions - token权限位掩码
 * @param {number} requiredPermission - 要求的权限
 * @returns {boolean} 是否有权限
 */
export const hasPermission = (tokenPermissions, requiredPermission) => {
  if (typeof tokenPermissions !== "number") return false;
  return (tokenPermissions & requiredPermission) === requiredPermission;
};

/**
 * IPC操作到权限的映射表
 * @constant
 * @type {Object.<string, number>}
 */
export const OperationPermissionMap = {
  "fs:read": Permission.READ,
  "fs:write": Permission.WRITE,
  "fs:exists": Permission.READ,
  "fs:delete": Permission.DELETE,
  "fs:ls": Permission.READ,
  "fs:mkdir": Permission.MKDIR,
  "fs:zip": Permission.ZIP,
  "fs:unzip": Permission.UNZIP,
  "fs:hide": Permission.HIDE,
  "fs:unhide": Permission.HIDE,
};

/**
 * 权限强制检查（核心middleware）
 * @param {Object} ctx - verify返回的上下文
 * @param {string} operation - IPC操作名称
 * @returns {Object} handle
 * @throws {Error} 权限不足或无效上下文
 */
export const enforcePermission = (ctx, operation) => {
  if (!ctx || !ctx.handle) {
    throw new Error("invalid capability context");
  }

  const required = OperationPermissionMap[operation];

  if (required == null) {
    throw new Error(`unknown operation: ${operation}`);
  }

  if (!hasPermission(ctx.permissions, required)) {
    throw new Error(`permission denied: ${operation}`);
  }

  return ctx.handle;
};

/**
 * 组合权限（用于authorize生成token）
 * @param {...number} perms - 权限位
 * @returns {number} 组合后的权限位掩码
 */
export const combinePermissions = (...perms) => {
  return perms.reduce((acc, p) => acc | p, 0);
};