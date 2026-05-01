class LocaleManager {
  constructor() {
    /**
     * 已加载语言缓存
     * @type {Record<string, any>}
     */
    this.locales = {};

    /**
     * 当前语言
     * @type {any|null}
     */
    this.currentLocale = null;

    /**
     * 当前语言ID
     * @type {string}
     */
    this.currentLocaleId = "zh-CN";

    /**
     * 是否已初始化
     */
    this.initialized = false;
  }

  // ==============================
  // 🌐 初始化
  // ==============================

  /**
   * 初始化语言（必须由 preload 或 app 主动调用）
   * @param {string} localeId
   */
  async init(localeId = "zh-CN") {
    this.currentLocaleId = localeId;
    const locale = await this.loadLocale(localeId);

    this.currentLocale = locale;
    this.initialized = true;

    return locale;
  }

  // ==============================
  // 📦 语言加载（唯一 IO 入口）
  // ==============================

  /**
   * ⚠️ 关键点：
   * 这里只允许走 preload 提供的安全 FS API
   */
  async loadLocale(localeId) {
    try {
      if (!window?.safeIO?.fs) {
        throw new Error("safeIO.fs not available");
      }

      const baseToken = window.__LOCALE_TOKEN__;

      if (!baseToken) {
        throw new Error("missing locale capability token");
      }

      // 统一路径由 main/control layer 决定
      const pathToken = {
        ...baseToken,
        meta: {
          type: "locale",
          localeId,
        },
      };

      const content = await window.safeIO.fs.read(pathToken);

      const locale = JSON.parse(content);

      this.locales[localeId] = locale;

      return locale;
    } catch (e) {
      console.error("[LocaleManager] loadLocale failed:", e);

      if (localeId !== "zh-CN") {
        return this.loadLocale("zh-CN");
      }

      throw e;
    }
  }

  // ==============================
  // 🌍 翻译核心
  // ==============================

  /**
   * 翻译函数
   * @param {string} keyPath
   * @param {Object} params
   */
  t(keyPath, params = {}) {
    if (!this.currentLocale) {
      console.warn("[i18n] locale not initialized");
      return keyPath;
    }

    const keys = keyPath.split(".");
    let value = this.currentLocale.translations;

    for (const key of keys) {
      if (!value || typeof value !== "object" || !(key in value)) {
        console.warn(`[i18n] missing key: ${keyPath}`);
        return keyPath;
      }
      value = value[key];
    }

    if (typeof value !== "string") {
      return keyPath;
    }

    // 参数替换
    if (params && Object.keys(params).length > 0) {
      return value.replace(/\{\{(\w+)\}\}/g, (_, k) =>
        params[k] !== undefined ? params[k] : `{{${k}}}`
      );
    }

    return value;
  }

  // ==============================
  // 🌐 状态查询
  // ==============================

  getCurrentLocale() {
    return this.currentLocale;
  }

  getCurrentLocaleId() {
    return this.currentLocaleId;
  }

  getAvailableLocales() {
    return Object.values(this.locales);
  }

  isInitialized() {
    return this.initialized;
  }

  // ==============================
  // 🔁 切换语言
  // ==============================

  async switchLocale(localeId) {
    if (localeId === this.currentLocaleId) return this.currentLocale;

    const locale = await this.loadLocale(localeId);

    this.currentLocale = locale;
    this.currentLocaleId = localeId;

    return locale;
  }
}

// ==============================
// 🌉 单例导出
// ==============================

window.localeManager = new LocaleManager();

export default window.localeManager;