/**
 * @fileoverview Capability Registry - Handle生命周期与Token管理
 * @module safe-io/auth/registry
 *
 * @description
 * 职责：
 * 1. 管理 handle 生命周期
 * 2. token → handle 映射
 * 3. revoke capability
 * 4. GC（避免泄漏）
 * 5. IPC lookup 安全入口
 *
 * @author safe-io Team
 * @version 3.0
 */

import { EventEmitter } from "events";

/**
 * @typedef {Object} HandleMetadata
 * @property {number} createdAt - 创建时间戳
 * @property {string} root - 根路径
 * @property {Object} permissions - 权限配置
 * @property {boolean} revoked - 是否已撤销
 */

/**
 * Handle映射表 - token.id → handle
 * @type {Map<string, Object>}
 */
const handleMap = new Map();

/**
 * 元数据映射表 - token.id → metadata
 * @type {Map<string, HandleMetadata>}
 */
const metaMap = new Map();

/**
 * 注册事件发射器
 * @type {EventEmitter}
 */
export const registryEvents = new EventEmitter();

/**
 * 注册 capability
 * @param {Object} token - Token对象
 * @param {Object} handle - FileHandle实例
 * @returns {boolean} 是否注册成功
 */
export const register = (token, handle) => {
  if (!token?.id || !handle) return false;

  handleMap.set(token.id, handle);

  metaMap.set(token.id, {
    createdAt: Date.now(),
    root: token.root,
    permissions: token.permissions,
    revoked: false,
  });

  registryEvents.emit("register", token.id);

  return true;
};

/**
 * 查找 capability
 * @param {string} tokenId - Token ID
 * @returns {Object|null} Handle实例或null
 */
export const get = (tokenId) => {
  const meta = metaMap.get(tokenId);

  if (!meta || meta.revoked) return null;

  return handleMap.get(tokenId) || null;
};

/**
 * 撤销 capability
 * @param {string} tokenId - Token ID
 * @returns {boolean} 是否撤销成功
 */
export const revoke = (tokenId) => {
  const meta = metaMap.get(tokenId);

  if (!meta) return false;

  meta.revoked = true;

  handleMap.delete(tokenId);

  registryEvents.emit("revoke", tokenId);

  return true;
};

/**
 * 默认TTL（30分钟）
 * @type {number}
 */
const DEFAULT_TTL = 1000 * 60 * 30;

/**
 * 垃圾回收 - 清理过期的capability
 * @param {number} [ttl=DEFAULT_TTL] - 生存时间
 * @returns {void}
 */
export const gc = (ttl = DEFAULT_TTL) => {
  const now = Date.now();

  for (const [id, meta] of metaMap.entries()) {
    if (meta.revoked) {
      handleMap.delete(id);
      metaMap.delete(id);
      continue;
    }

    if (now - meta.createdAt > ttl) {
      handleMap.delete(id);
      metaMap.delete(id);

      registryEvents.emit("gc", id);
    }
  }
};

/**
 * GC定时器句柄
 * @type {NodeJS.Timeout|null}
 */
let gcTimer = null;

/**
 * 启动定期GC
 * @param {number} [interval=60000] - 间隔时间（毫秒）
 * @returns {void}
 */
export const startGC = (interval = 60000) => {
  if (gcTimer) return;

  gcTimer = setInterval(() => {
    gc();
  }, interval);
};

/**
 * 停止定期GC
 * @returns {void}
 */
export const stopGC = () => {
  if (gcTimer) {
    clearInterval(gcTimer);
    gcTimer = null;
  }
};

/**
 * @typedef {Object} RegistryStats
 * @property {number} size - 当前handle数量
 * @property {number} revoked - 已撤销数量
 */

/**
 * 获取注册表统计信息
 * @returns {RegistryStats} 统计信息
 */
export const stats = () => ({
  size: handleMap.size,
  revoked: [...metaMap.values()].filter(m => m.revoked).length,
});

/**
 * 清除所有注册（仅供开发/测试用）
 * @returns {void}
 */
export const clear = () => {
  handleMap.clear();
  metaMap.clear();
  registryEvents.removeAllListeners();
};