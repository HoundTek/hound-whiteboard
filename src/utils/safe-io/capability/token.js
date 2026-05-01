import { randomUUID } from "crypto";
import { sign } from "../crypto/sign.js";

/**
 * safe-io capability token
 * ------------------------
 * 目标：
 * - 防伪造（signature）
 * - 防篡改（canonical payload）
 * - 防重放（timestamp + nonce）
 * - IPC 安全传输单位
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
// 🔐 create capability token
// ==============================

export const createToken = (handle) => {
  const payload = buildPayload({
    id: randomUUID(),
    root: handle.path,
    permissions: handle.permissions || {},
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
  });
};