import { verify as verifySignature } from "../crypto/sign.js";
import { get } from "../auth/registry.js";

/**
 * safe-io IPC verify layer (v2)
 * -----------------------------
 * 职责升级：
 * 1. 验证 token 签名
 * 2. 校验结构完整性
 * 3. 防重放（timestamp + nonce）
 * 4. registry capability lookup
 * 5. 绑定 permissions（用于后续 enforcement layer）
 * 6. 返回 capability context（而不是 raw handle）
 */

// ==============================
// 🧠 replay protection store
// ==============================

const usedNonces = new Set();
const nonceTimeMap = new Map();

const NONCE_TTL = 1000 * 60 * 10; // 10 min

// ==============================
// 🔍 canonical payload builder
// ==============================

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

// ==============================
// ⛔ replay protection
// ==============================

const checkReplay = (token) => {
  const now = Date.now();

  // timestamp window (5 min)
  if (Math.abs(now - token.timestamp) > 1000 * 60 * 5) {
    return false;
  }

  // nonce reuse
  if (usedNonces.has(token.nonce)) {
    return false;
  }

  usedNonces.add(token.nonce);
  nonceTimeMap.set(token.nonce, now);

  return true;
};

// cleanup expired nonces
setInterval(() => {
  const now = Date.now();

  for (const [nonce, time] of nonceTimeMap.entries()) {
    if (now - time > NONCE_TTL) {
      nonceTimeMap.delete(nonce);
      usedNonces.delete(nonce);
    }
  }
}, 60_000);

// ==============================
// 🔐 MAIN VERIFY FUNCTION (UPDATED)
// ==============================

/**
 * verify(token)
 * 返回：capability context（不是 raw handle）
 */
export const verify = (token) => {
  if (!token) {
    throw new Error("missing token");
  }

  // 1. structural validation
  if (
    !token.id ||
    !token.root ||
    !token.signature ||
    typeof token.timestamp !== "number"
  ) {
    throw new Error("invalid token structure");
  }

  // 2. canonical payload
  const canonical = canonicalize(token);

  // 3. signature verification
  const ok = verifySignature(canonical, token.signature);

  if (!ok) {
    throw new Error("invalid signature");
  }

  // 4. replay protection
  if (!checkReplay(token)) {
    throw new Error("replay attack detected or expired token");
  }

  // 5. capability lookup
  const handle = get(token.id);

  if (!handle) {
    throw new Error("capability revoked or not found");
  }

  // ==============================
  // 🧠 NEW: capability context
  // ==============================

  /**
   * ⚠️关键变化：
   * 不再直接返回 handle
   * 而是返回 "execution context"
   *
   * 这样 permission layer 才能插入
   */
  return {
    handle,
    permissions: token.permissions, // bitmask used by enforcement layer
    id: token.id,
    root: token.root,
  };
};