/**
 * @fileoverview Cryptographic Signing Module - HMAC签名与验证
 * @module safe-io/crypto/sign
 *
 * @description
 * 目标：
 * - 防伪造 token
 * - 防篡改 payload
 * - 防重放（配合 timestamp）
 * - 支持 Electron main-only secret
 *
 * @author safe-io Team
 * @version 3.0
 */

import crypto from "crypto";

/**
 * 签名密钥（从环境变量或使用默认值）
 * @type {string}
 */
const SECRET =
  process.env.CAPABILITY_SECRET ||
  "dev-secret-change-me-strongly-rotate-in-prod";

/**
 * 规范化数据为JSON字符串
 * @param {Object} data - 数据对象
 * @returns {string} 规范化的JSON字符串
 */
const normalize = (data) => {
  return JSON.stringify(data, Object.keys(data).sort());
};

/**
 * 对数据签名
 * @param {string|Object} data - 要签名的数据
 * @returns {string} 十六进制签名字符串
 */
export const sign = (data) => {
  const payload = typeof data === "string" ? data : normalize(data);

  return crypto
    .createHmac("sha256", SECRET)
    .update(payload, "utf8")
    .digest("hex");
};

/**
 * 验证签名
 * @param {string|Object} data - 原始数据
 * @param {string} signature - 要验证的签名
 * @returns {boolean} 签名是否有效
 */
export const verify = (data, signature) => {
  const payload = typeof data === "string" ? data : normalize(data);

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(payload, "utf8")
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};

/**
 * 调试签名（仅供开发/测试用）
 * @param {Object} obj - 要签名的对象
 * @returns {Object} 包含payload和signature的对象
 */
export const debugSign = (obj) => {
  const payload = normalize(obj);
  return {
    payload,
    signature: sign(payload),
  };
};