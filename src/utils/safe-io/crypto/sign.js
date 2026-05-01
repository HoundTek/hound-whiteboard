import crypto from "crypto";

/**
 * safe-io capability signing module
 * ---------------------------------
 * 目标：
 * - 防伪造 token
 * - 防篡改 payload
 * - 防重放（配合 timestamp）
 * - 支持 Electron main-only secret
 */

// ==============================
// 🔐 secret management
// ==============================

const SECRET =
  process.env.CAPABILITY_SECRET ||
  "dev-secret-change-me-strongly-rotate-in-prod";

// ==============================
// 🧠 normalize input (critical)
// ==============================

const normalize = (data) => {
  // 保证跨进程一致性（非常关键）
  return JSON.stringify(data, Object.keys(data).sort());
};

// ==============================
// ✍ sign
// ==============================

export const sign = (data) => {
  const payload = typeof data === "string" ? data : normalize(data);

  return crypto
    .createHmac("sha256", SECRET)
    .update(payload, "utf8")
    .digest("hex");
};

// ==============================
// 🔍 verify
// ==============================

export const verify = (data, signature) => {
  const payload = typeof data === "string" ? data : normalize(data);

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(payload, "utf8")
    .digest("hex");

  // timing-safe compare（防时序攻击）
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};

// ==============================
// 🧪 optional helper (debug only)
// ==============================

export const debugSign = (obj) => {
  const payload = normalize(obj);
  return {
    payload,
    signature: sign(payload),
  };
};