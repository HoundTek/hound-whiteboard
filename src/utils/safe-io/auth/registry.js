import { EventEmitter } from "events";

/**
 * safe-io capability registry
 * ---------------------------
 * 职责：
 * 1. 管理 handle 生命周期
 * 2. token → handle 映射
 * 3. revoke capability
 * 4. GC（避免泄漏）
 * 5. IPC lookup 安全入口
 */

// ==============================
// 🧠 internal storage
// ==============================

const handleMap = new Map();   // token.id → handle
const metaMap = new Map();     // token.id → metadata

// ==============================
// 📡 event system（debug / lifecycle）
// ==============================

export const registryEvents = new EventEmitter();

// ==============================
// 🔐 register capability
// ==============================

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

// ==============================
// 🔎 lookup capability
// ==============================

export const get = (tokenId) => {
  const meta = metaMap.get(tokenId);

  if (!meta || meta.revoked) return null;

  return handleMap.get(tokenId) || null;
};

// ==============================
// ❌ revoke capability
// ==============================

export const revoke = (tokenId) => {
  const meta = metaMap.get(tokenId);

  if (!meta) return false;

  meta.revoked = true;

  handleMap.delete(tokenId);

  registryEvents.emit("revoke", tokenId);

  return true;
};

// ==============================
// 🧹 garbage collection (TTL cleanup)
// ==============================

const DEFAULT_TTL = 1000 * 60 * 30; // 30 min

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

// ==============================
// 🔁 periodic GC runner
// ==============================

let gcTimer = null;

export const startGC = (interval = 60000) => {
  if (gcTimer) return;

  gcTimer = setInterval(() => {
    gc();
  }, interval);
};

export const stopGC = () => {
  if (gcTimer) {
    clearInterval(gcTimer);
    gcTimer = null;
  }
};

// ==============================
// 📊 debug helpers
// ==============================

export const stats = () => ({
  size: handleMap.size,
  revoked: [...metaMap.values()].filter(m => m.revoked).length,
});

// ==============================
// ⚠️ hard reset (dev only)
// ==============================

export const clear = () => {
  handleMap.clear();
  metaMap.clear();
  registryEvents.removeAllListeners();
};