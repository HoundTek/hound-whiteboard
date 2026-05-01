/**
 * safe-io permission layer
 * ------------------------
 * 作用：
 * 1. 定义 bitmask 权限
 * 2. 提供权限判断
 * 3. 将 IPC 操作映射为权限
 * 4. 提供统一 enforcement 接口
 */

// ==============================
// 🧩 Bitmask Permissions
// ==============================

export const Permission = {
  READ: 1 << 0,     // 0000001
  WRITE: 1 << 1,    // 0000010
  DELETE: 1 << 2,   // 0000100
  MKDIR: 1 << 3,    // 0001000
  ZIP: 1 << 4,      // 0010000
  UNZIP: 1 << 5,    // 0100000
  HIDE: 1 << 6,     // 1000000
};

// ==============================
// 🔍 bitmask check
// ==============================

/**
 * 判断 token 是否拥有指定权限
 *
 * @param {number} tokenPermissions
 * @param {number} requiredPermission
 * @returns {boolean}
 */
export const hasPermission = (tokenPermissions, requiredPermission) => {
  if (typeof tokenPermissions !== "number") return false;
  return (tokenPermissions & requiredPermission) === requiredPermission;
};

// ==============================
// ⚙️ operation → permission mapping
// ==============================

/**
 * IPC 操作到权限的映射表
 * （安全策略核心）
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

// ==============================
// 🔐 enforcement layer
// ==============================

/**
 * 权限强制检查（核心 middleware）
 *
 * @param {object} ctx - verify 返回的上下文
 * @param {string} operation - IPC operation name
 * @returns {object} handle
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

// ==============================
// 🧠 helper (optional)
// ==============================

/**
 * 组合权限（用于 authorize 生成 token）
 */
export const combinePermissions = (...perms) => {
  return perms.reduce((acc, p) => acc | p, 0);
};