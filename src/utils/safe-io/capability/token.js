import { randomUUID } from "crypto";
import { sign } from "../crypto/sign.js";
import { Permission, combinePermissions } from "../auth/permission.js";

/**
 * safe-io capability token
 * ------------------------
 * 目标：
 * - 防伪造（signature）
 * - 防篡改（canonical payload）
 * - 防重放（timestamp + nonce）
 * - IPC 安全传输单位
 * - 支持 bitmask 权限格式
 */

// ==============================
// 🧠 canonical payload builder
// ==============================

const buildPayload = ({
  id,
  root,
  permissions,
  timestamp,
  nonce,
}) => ({
  id,
  root,
  permissions,
  timestamp,
  nonce,
});

// ==============================
// 🧠 权限格式转换
// ==============================

/**
 * 将对象格式权限转换为 bitmask
 * @param {Object} permissionsObj - { read: true, write: false, ... }
 * @returns {number} - bitmask 权限值
 */
const permissionsObjToBitmask = (permissionsObj) => {
  if (!permissionsObj || typeof permissionsObj !== "object") {
    return 0;
  }

  let bitmask = 0;

  if (permissionsObj.read) bitmask |= Permission.READ;
  if (permissionsObj.write) bitmask |= Permission.WRITE;
  if (permissionsObj.rm || permissionsObj.delete) bitmask |= Permission.DELETE;
  if (permissionsObj.mkdir) bitmask |= Permission.MKDIR;
  if (permissionsObj.zip) bitmask |= Permission.ZIP;
  if (permissionsObj.unzip) bitmask |= Permission.UNZIP;
  if (permissionsObj.hide) bitmask |= Permission.HIDE;

  return bitmask;
};

/**
 * 检测权限格式并返回标准化的 bitmask
 * @param {Object|number} permissions - 对象格式或 bitmask
 * @returns {number} - 标准化的 bitmask
 */
const normalizePermissions = (permissions) => {
  if (typeof permissions === "number") {
    return permissions;
  }
  return permissionsObjToBitmask(permissions);
};

// ==============================
// 🔐 create capability token
// ==============================

export const createToken = (handle) => {
  // 将权限转换为 bitmask 格式
  const bitmaskPermissions = normalizePermissions(handle.permissions);

  const payload = buildPayload({
    id: randomUUID(),
    root: handle.path,
    permissions: bitmaskPermissions, // 使用 bitmask
    timestamp: Date.now(),
    nonce: randomUUID(),
  });

  // ⚠️ 必须使用 canonical stringify（顺序稳定）
  const canonical = JSON.stringify(
    payload,
    Object.keys(payload).sort()
  );

  const signature = sign(canonical);

  return Object.freeze({
    ...payload,
    signature,

    /**
     * 重新生成 canonical string（用于 verify）
     */
    canonical: () =>
      JSON.stringify(payload, Object.keys(payload).sort()),

    /**
     * 获取原始权限对象（方便调试）
     */
    originalPermissions: handle.permissions,
  });
};

// ==============================
// 🧪 辅助函数：创建预设权限 token
// ==============================

/**
 * 使用预设权限创建 token
 * @param {string} path - 文件路径
 * @param {string} preset - 预设权限名称：'READ_ONLY', 'READ_WRITE', 'FULL'
 * @returns {Object} - token 对象
 */
export const createTokenWithPreset = (path, preset = "READ_ONLY") => {
  let bitmask = 0;

  switch (preset) {
    case "READ_ONLY":
      bitmask = combinePermissions(Permission.READ);
      break;
    case "READ_WRITE":
      bitmask = combinePermissions(Permission.READ, Permission.WRITE, Permission.MKDIR);
      break;
    case "FULL":
      bitmask = combinePermissions(
        Permission.READ,
        Permission.WRITE,
        Permission.DELETE,
        Permission.MKDIR,
        Permission.ZIP,
        Permission.UNZIP,
        Permission.HIDE
      );
      break;
    default:
      bitmask = combinePermissions(Permission.READ);
  }

  const payload = buildPayload({
    id: randomUUID(),
    root: path,
    permissions: bitmask,
    timestamp: Date.now(),
    nonce: randomUUID(),
  });

  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const signature = sign(canonical);

  return Object.freeze({
    ...payload,
    signature,
    canonical: () => JSON.stringify(payload, Object.keys(payload).sort()),
  });
};