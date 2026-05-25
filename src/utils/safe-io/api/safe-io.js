/**
 * @fileoverview Safe IO API Layer - safe-io对外暴露的API接口
 * @module safe-io/api/safe-io
 *
 * @description
 * safe-io的安全IO封装层，仅暴露必要接口给renderer。
 *
 * 设计原则：
 * - 不暴露 runtime (fs/zip/hide)
 * - 不暴露 authorize 内部结构
 * - 只返回 capability handle
 * - renderer 只接触这一层
 *
 * @author safe-io Team
 * @version 3.0
 */

import { registerRoot, authorize, clearRoots } from "../auth/authorize.js";
import { BaseDir, Dir, File, createBaseDir, cd, father } from "../core/safe-io-core.js";

/**
 * 打开安全IO操作句柄
 * @param {BaseDir} base - 基础目录
 * @param {Dir|File} entry - DSL条目
 * @param {Object} [permissions] - 权限配置（可选）
 * @returns {Object|null} FileHandle对象或null
 *
 * @description
 * 内部调用authorize获取授权，返回封装好的FileHandle。
 * 权限在handle内部已经 baked in。
 */
const open = (base, entry, permissions) => {
  const handleOption = authorize(base, entry);

  if (!handleOption || handleOption.__tag === "None") {
    return null;
  }

  const handle = handleOption[0];

  if (permissions) {
    return handle;
  }

  return handle;
};

/**
 * 注册根目录
 * @param {string} path - 根目录路径
 * @returns {void}
 */
const register = (path) => registerRoot(path);

/**
 * 清除所有注册的根目录（仅用于开发/测试）
 * @returns {void}
 */
const reset = () => clearRoots();

/**
 * @namespace safeIO
 * @description Safe IO API命名空间
 */
export const safeIO = {

  /**
   * 注册根目录
   * @type {Function}
   */
  register,

  /**
   * 重置根目录注册
   * @type {Function}
   */
  reset,

  /**
   * 打开安全IO句柄
   * @type {Function}
   */
  open,

  /**
   * @name BaseDir
   * @description 基础目录类型/构造器
   */
  BaseDir,

  /**
   * @name Dir
   * @description 目录描述符类型/构造器
   */
  Dir,

  /**
   * @name File
   * @description 文件描述符类型/构造器
   */
  File,

  /**
   * @name createBaseDir
   * @description 创建BaseDir的辅助函数
   */
  createBaseDir,

  /**
   * @name cd
   * @description cd-like路径导航函数
   */
  cd,

  /**
   * @name father
   * @description 获取上级目录函数
   */
  father,
};

/**
 * @default safeIO
 */
export default safeIO;