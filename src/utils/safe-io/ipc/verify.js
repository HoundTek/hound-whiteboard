/**
 * @fileoverview IPC Verify Layer - Token验证与防重放攻击
 * @module safe-io/ipc/verify
 *
 * @description
 * 职责升级：
 * 1. 验证 token 签名
 * 2. 校验结构完整性
 * 3. 防重放（timestamp + nonce）
 * 4. registry capability lookup
 * 5. 绑定 permissions（用于后续 enforcement layer）
 * 6. 返回 capability context（而不是 raw handle）
 *
 * @author safe-io Team
 * @version 3.0
 */

import { verify as verifySignature } from "../crypto/sign.js";
import { get } from "../auth/registry.js";

/**
 * @typedef {Object} CapabilityContext
 * @property {Object} handle - FileHandle实例
 * @property {number} permissions - 权限位掩码
 * @property {string} id - Token ID
 * @property {string} root - 根路径
 */

/**
 * Nonce映射表 - 用于防重放
 * @type {Map<string, number>}
 */
const nonceTimeMap = new Map();

/**
 * 已使用的Nonce集合 - 用于防重放检测
 * @type {Set<string>}
 */
const usedNonces = new Set();

/**
 * Nonce有效期 TTL（10分钟）
 * @type {number}
 */
const NONCE_TTL = 1000 * 60 * 10;

/**
 * 规范化Token payload为JSON字符串
 * @param {Object} token - Token对象
 * @returns {string} 规范化的JSON字符串
 */
const canonicalize = (token) => {
  return JSON.stringify(
    {
      id: token.id,
      root: token.root,
      permissions: token.permissions,
      timestamp: token.timestamp,
      nonce: token.nonce,
    },
    Object.keys(token).sort()
  );
};

/**
 * 防重放检查
 * @param {Object} token - Token对象
 * @returns {boolean} 是否通过检查
 */
const checkReplay = (token) => {
  const now = Date.now();

  if (Math.abs(now - token.timestamp) > 1000 * 60 * 5) {
    return false;
  }

  if (usedNonces.has(token.nonce)) {
    return false;
  }

  usedNonces.add(token.nonce);
  nonceTimeMap.set(token.nonce, now);

  return true;
};

/**
 * 清理过期的Nonce
 */
setInterval(() => {
  const now = Date.now();

  for (const [nonce, time] of nonceTimeMap.entries()) {
    if (now - time > NONCE_TTL) {
      nonceTimeMap.delete(nonce);
      usedNonces.delete(nonce);
    }
  }
}, 60_000);

/**
 * 验证Token并返回capability context
 * @param {Object} token - Token对象
 * @returns {CapabilityContext} capability上下文
 */
export const verify = (token) => {
  if (!token) {
    throw new Error("missing token");
  }

  if (
    !token.id ||
    !token.root ||
    !token.signature ||
    typeof token.timestamp !== "number"
  ) {
    throw new Error("invalid token structure");
  }

  const canonical = canonicalize(token);

  const ok = verifySignature(canonical, token.signature);

  if (!ok) {
    throw new Error("invalid signature");
  }

  if (!checkReplay(token)) {
    throw new Error("replay attack detected or expired token");
  }

  const handle = get(token.id);

  if (!handle) {
    throw new Error("capability revoked or not found");
  }

  return {
    handle,
    permissions: token.permissions,
    id: token.id,
    root: token.root,
  };
};