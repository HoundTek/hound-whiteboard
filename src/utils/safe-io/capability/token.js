/**
 * @fileoverview Capability Token - Token创建与签名
 * @module safe-io/capability/token
 *
 * @description
 * 目标：
 * - 防伪造（signature）
 * - 防篡改（canonical payload）
 * - 防重放（timestamp + nonce）
 * - IPC 安全传输单位
 * - 支持 bitmask 权限格式
 *
 * @author safe-io Team
 * @version 3.0
 */

import { randomUUID } from "crypto";
import { sign } from "../crypto/sign.js";
import { Permission, combinePermissions } from "../auth/permission.js";

/**
 * @typedef {Object} TokenPayload
 * @property {string} id - Token唯一ID
 * @property {string} root - 根路径
 * @property {number} permissions - 权限位掩码
 * @property {number} timestamp - 创建时间戳
 * @property {string} nonce - 随机nonce
 */

/**
 * @typedef {Object} Token
 * @property {string} id - Token唯一ID
 * @property {string} root - 根路径
 * @property {number} permissions - 权限位掩码
 * @property {number} timestamp - 创建时间戳
 * @property {string} nonce - 随机nonce
 * @property {string} signature - 签名
 */

/**
 * 构建Token payload对象
 * @param {Object} params - 参数对象
 * @param {string} params.id - Token ID
 * @param {string} params.root - 根路径
 * @param {number} params.permissions - 权限位掩码
 * @param {number} params.timestamp - 时间戳
 * @param {string} params.nonce - Nonce
 * @returns {TokenPayload} Token payload
 */
const buildPayload = ({ id, root, permissions, timestamp, nonce }) => ({
  id,
  root,
  permissions,
  timestamp,
  nonce,
});

/**
 * 将对象格式权限转换为 bitmask
 * @param {Object} permissionsObj - 权限对象
 * @returns {number} bitmask权限值
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
 * 规范化权限格式为bitmask
 * @param {Object|number} permissions - 权限对象或bitmask
 * @returns {number} 标准化的bitmask
 */
const normalizePermissions = (permissions) => {
  if (typeof permissions === "number") {
    return permissions;
  }
  return permissionsObjToBitmask(permissions);
};

/**
 * 创建capability token
 * @param {Object} handle - FileHandle对象
 * @returns {Token} Token对象
 */
export const createToken = (handle) => {
  const bitmaskPermissions = normalizePermissions(handle.permissions);

  const payload = buildPayload({
    id: randomUUID(),
    root: handle.path,
    permissions: bitmaskPermissions,
    timestamp: Date.now(),
    nonce: randomUUID(),
  });

  const canonical = JSON.stringify(
    payload,
    Object.keys(payload).sort()
  );

  const signature = sign(canonical);

  return Object.freeze({
    ...payload,
    signature,

    /**
     * 重新生成canonical string
     * @returns {string} canonical JSON string
     */
    canonical: () =>
      JSON.stringify(payload, Object.keys(payload).sort()),

    /**
     * 获取原始权限对象
     * @returns {Object} 原始权限对象
     */
    originalPermissions: handle.permissions,
  });
};

/**
 * 使用预设权限创建token
 * @param {string} path - 文件路径
 * @param {string} [preset='READ_ONLY'] - 预设权限名称
 * @returns {Token} Token对象
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