/**
 * @fileoverview Hidden File Runtime - 隐藏文件操作封装
 * @module safe-io/runtime/hide
 *
 * @description
 * 提供跨平台的隐藏文件操作能力，纯runtime层无安全逻辑。
 *
 * @author safe-io Team
 * @version 3.0
 */

import hidefile from "hidefile";

/**
 * @fileoverview Safe wrapper for hidefile operations
 *
 * @description
 * 设计原则：
 * - 不做权限判断
 * - 不处理 DSL entry
 * - 不参与 capability
 * - 只包装 hidefile + fallback
 */

const safeCall = (fn, fallback) => {
  try {
    return fn();
  } catch (e) {
    console.warn("[hidefile runtime error]", e);
    return fallback;
  }
};

/**
 * @namespace Hide
 * @description 隐藏文件操作命名空间
 */
export const Hide = {

  /**
   * 隐藏文件或目录
   * @param {string} p - 文件路径
   * @returns {boolean|null} 是否成功
   *
   * @description
   * - Unix: 添加"."前缀
   * - Windows: 添加"."前缀并设置hidden属性
   */
  hide: (p) => {
    return safeCall(() => hidefile.hideSync(p), null);
  },

  /**
   * 取消隐藏文件或目录
   * @param {string} p - 文件路径
   * @returns {boolean|null} 是否成功
   */
  unhide: (p) => {
    return safeCall(() => hidefile.revealSync(p), null);
  },

  /**
   * 切换隐藏状态
   * @param {string} p - 文件路径
   * @returns {boolean|null} 是否成功
   */
  toggle: (p) => {
    return safeCall(() => hidefile.toggleSync(p), null);
  },

  /**
   * 检查文件是否隐藏
   * @param {string} p - 文件路径
   * @returns {boolean} 是否隐藏
   */
  isHidden: (p) => {
    return safeCall(() => hidefile.isHiddenSync(p), false);
  },

  /**
   * 检查文件是否应该被隐藏（平台感知）
   * @param {string} p - 文件路径
   * @returns {boolean} 是否应该隐藏
   */
  shouldBeHidden: (p) => {
    return safeCall(() => hidefile.shouldBeHiddenSync(p), false);
  },

  /**
   * 检查是否有点前缀（快速路径）
   * @param {string} p - 文件路径
   * @returns {boolean} 是否有点前缀
   */
  isDotPrefixed: (p) => {
    return safeCall(() => hidefile.isDotPrefixed(p), false);
  },
};