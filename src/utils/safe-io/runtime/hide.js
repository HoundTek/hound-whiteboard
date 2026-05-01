import hidefile from "hidefile";

/**
 * runtime/hide.js
 * ----------------
 * 纯隐藏文件能力层（no security logic）
 *
 * 设计原则：
 * - 不做权限判断
 * - 不处理 DSL entry
 * - 不参与 capability
 * - 只包装 hidefile + fallback
 */

// ==============================
// 🔎 hidden state detection
// ==============================

const safeCall = (fn, fallback) => {
  try {
    return fn();
  } catch (e) {
    console.warn("[hidefile runtime error]", e);
    return fallback;
  }
};

// ==============================
// 👁 hide API
// ==============================

export const Hide = {

  /**
   * hide path
   * Unix: adds "."
   * Windows: adds "." + hidden attribute
   */
  hide: (p) => {
    return safeCall(() => hidefile.hideSync(p), null);
  },

  /**
   * unhide / reveal path
   */
  unhide: (p) => {
    return safeCall(() => hidefile.revealSync(p), null);
  },

  /**
   * toggle hidden state
   */
  toggle: (p) => {
    return safeCall(() => hidefile.toggleSync(p), null);
  },

  // ==============================
  // 🔍 state queries
  // ==============================

  /**
   * check if file is hidden
   */
  isHidden: (p) => {
    return safeCall(() => hidefile.isHiddenSync(p), false);
  },

  /**
   * check if should be hidden (platform-aware)
   */
  shouldBeHidden: (p) => {
    return safeCall(() => hidefile.shouldBeHiddenSync(p), false);
  },

  /**
   * check dot-prefix only (fast path)
   */
  isDotPrefixed: (p) => {
    return safeCall(() => hidefile.isDotPrefixed(p), false);
  },
};