/**
 * @fileoverview Safe IO Core - 路径DSL与基础工具层
 * @module safe-io/core/safe-io-core
 *
 * @description
 * 提供：
 * - 路径名称校验
 * - DSL数据结构的定义（BaseDir, Dir, File）
 * - 路径组合纯函数
 * - DSL辅助构造器
 *
 * 注意：
 * - 不包含fs操作
 * - 不包含权限系统
 * - 不包含handle
 * - 不包含IO副作用
 *
 * @author safe-io Team
 * @version 3.0
 */

import path from "path";

/**
 * 校验路径名称是否合法
 * @param {string} name - 要校验的名称
 * @returns {boolean} 是否合法
 */
export const isValidName = (name) => {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 255) return false;

  if (name === "." || name === "..") return false;
  if (name.endsWith(".")) return false;

  const invalidChars = [
    "/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\0"
  ];

  return !invalidChars.some(c => name.includes(c));
};

/**
 * BaseDir - 表示一个已解析的根路径
 * @typedef {Object} BaseDir
 * @property {string} __type - 类型标识 "BaseDir"
 * @property {string[]} segments - 路径段数组
 */

/**
 * 创建BaseDir实例
 * @param {string[]} segments - 路径段数组
 * @returns {BaseDir} BaseDir实例
 */
export const BaseDir = (segments) => ({
  __type: "BaseDir",
  segments: Object.freeze([...segments]),
});

/**
 * Dir - 目录描述符
 * @typedef {Object} Dir
 * @property {string} __type - 类型标识 "Dir"
 * @property {string} name - 目录名称
 */

/**
 * 创建Dir实例
 * @param {string} name - 目录名称
 * @returns {Dir} Dir实例
 */
export const Dir = (name) => ({
  __type: "Dir",
  name,
});

/**
 * File - 文件描述符
 * @typedef {Object} File
 * @property {string} __type - 类型标识 "File"
 * @property {string} name - 文件名（不含扩展名）
 * @property {string} ext - 扩展名
 */

/**
 * 创建File实例
 * @param {string} name - 文件名（不含扩展名）
 * @param {string} [ext] - 扩展名
 * @returns {File} File实例
 */
export const File = (name, ext = "") => ({
  __type: "File",
  name,
  ext,
});

/**
 * 将DSL转换为相对路径字符串
 * @param {BaseDir} base - 基础目录
 * @param {Dir|File} entry - DSL条目
 * @returns {string} 相对路径字符串
 *
 * @description
 * 注意：不做权限检查，不访问fs，不检查exists
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

  return basePath;
};

/**
 * 创建BaseDir的安全辅助函数
 * @param {string[]} segments - 路径段数组
 * @returns {BaseDir} BaseDir实例
 * @throws {Error} 如果segments无效
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
 * cd-like辅助函数（纯表达，不访问fs）
 * @param {BaseDir} base - 当前基础目录
 * @param {string} name - 子目录名称
 * @returns {BaseDir|null} 新的BaseDir或null
 */
export const cd = (base, name) => {
  if (!isValidName(name)) return null;

  return BaseDir([...base.segments, name]);
};

/**
 * 获取上级目录
 * @param {BaseDir} base - 当前基础目录
 * @returns {BaseDir|null} 新的BaseDir或null
 */
export const father = (base) => {
  if (base.segments.length === 0) return null;
  return BaseDir(base.segments.slice(0, -1));
};

/**
 * 调试用路径解析
 * @param {BaseDir} base - 基础目录
 * @param {Dir|File} entry - DSL条目
 * @returns {string} 解析后的路径
 */
export const debugPath = (base, entry) => {
  return resolvePath(base, entry);
};