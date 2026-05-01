/**
 * safe-io-core.js (v2)
 * --------------------
 * 纯路径 DSL + 基础工具层
 * 不包含：
 * - fs
 * - 权限系统
 * - handle
 * - IO side effects
 */

import path from "path";

// ==============================
// 🔐 基础工具：名称校验
// ==============================

export const isValidName = (name) => {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 255) return false;

  // 禁止非法路径语义
  if (name === "." || name === "..") return false;
  if (name.endsWith(".")) return false;

  // 跨平台非法字符（Windows + POSIX）
  const invalidChars = [
    "/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\0"
  ];

  return !invalidChars.some(c => name.includes(c));
};

// ==============================
// 📦 DSL：只描述结构，不表达行为
// ==============================

/**
 * BaseDir
 * 表示一个已解析的根路径（split后的 segments）
 */
export const BaseDir = (segments) => ({
  __type: "BaseDir",
  segments: Object.freeze([...segments]),
});

/**
 * Dir
 * 目录描述符（纯数据）
 */
export const Dir = (name) => ({
  __type: "Dir",
  name,
});

/**
 * File
 * 文件描述符（纯数据）
 */
export const File = (name, ext = "") => ({
  __type: "File",
  name,
  ext,
});

// ==============================
// 📍 路径组合（核心纯函数）
// ==============================

/**
 * 将 DSL 转换为“相对路径字符串”
 * ⚠️ 不做权限、不做 fs、不做 exists
 */
export const resolvePath = (base, entry) => {
  const basePath = path.join(...base.segments);

  if (entry.__type === "Dir") {
    return path.join(basePath, entry.name);
  }

  if (entry.__type === "File") {
    const fileName = entry.ext
      ? `${entry.name}.${entry.ext}`
      : entry.name;

    return path.join(basePath, fileName);
  }

  // fallback：只返回 base
  return basePath;
};

// ==============================
// 🌳 DSL 辅助构造（安全语义）
// ==============================

/**
 * safe segment join helper
 */
export const createBaseDir = (segments) => {
  if (!Array.isArray(segments)) {
    throw new Error("BaseDir requires string[] segments");
  }

  for (const s of segments) {
    if (!isValidName(s)) {
      throw new Error(`Invalid path segment: ${s}`);
    }
  }

  return BaseDir(segments);
};

/**
 * cd-like helper（纯表达，不访问 fs）
 */
export const cd = (base, name) => {
  if (!isValidName(name)) return null;

  return BaseDir([...base.segments, name]);
};

/**
 * father（上级目录）
 */
export const father = (base) => {
  if (base.segments.length === 0) return null;
  return BaseDir(base.segments.slice(0, -1));
};

// ==============================
// 🔎 调试工具（非核心）
// ==============================

export const debugPath = (base, entry) => {
  return resolvePath(base, entry);
};