/**
 * @file 语言管理器
 * @description 管理多语言支持，提供翻译功能
 * @module localeManager
 */

/**
 * @typedef {Object} LocaleTranslations
 * @property {Object} [tabs] - 标签页翻译
 * @property {Object} [pages] - 页面翻译
 * @property {Object} [buttons] - 按钮翻译
 */

/**
 * @typedef {Object} Locale
 * @property {string} id - 语言ID（如zh-CN）
 * @property {string} name - 语言名称
 * @property {string} nativeName - 本地名称
 * @property {LocaleTranslations} translations - 翻译表
 */

/**
 * 语言管理器类
 * @class
 */
class LocaleManager {
  /**
   * 创建语言管理器实例
   */
  constructor() {
    /**
     * 已加载的语言列表
     * @type {Object.<string, Locale>}
     */
    this.locales = {};
    
    /**
     * 当前语言
     * @type {Locale|null}
     */
    this.currentLocale = null;
    
    /**
     * 用户数据路径
     * @type {string}
     */
    this.userDataPath = '';
    
    // 尝试获取Electron用户数据路径
    if (typeof window.electron !== 'undefined' && window.electron.app) {
      this.userDataPath = window.electron.app.getUserDataPath();
    } else {
      // 开发环境使用实际appdata路径
      this.userDataPath = 'C:\\Users\\Frank\\AppData\\Roaming\\hound-whiteboard';
    }
  }

  /**
   * 加载语言包
   * @async
   * @param {string} localeId - 语言ID
   * @returns {Promise<Locale>} 语言对象
   * @throws {Error} 语言包不存在
   */
  async loadLocale(localeId) {
    try {
      const localePath = `${this.userDataPath}/data/locales/${localeId}.json`;
      
      // 优先通过fileUtils加载（IPC）
      if (window.fileUtils) {
        try {
          const locale = await window.fileUtils.readJSON(localePath);
          this.locales[localeId] = locale;
          this.currentLocale = locale;
          return locale;
        } catch (error) {
          console.warn('Error loading locale via fileUtils, falling back:', error);
        }
      }
      
      // 回退到fetch
      if (this.userDataPath !== './') {
        try {
          const response = await fetch(localePath);
          if (response.ok) {
            const locale = await response.json();
            this.locales[localeId] = locale;
            this.currentLocale = locale;
            return locale;
          }
        } catch (error) {
          console.warn('Error loading locale from appdata, falling back to local:', error);
        }
      }
      
      // 回退到本地语言目录
      const response = await fetch(`./locales/${localeId}.json`);
      if (!response.ok) {
        throw new Error(`Locale ${localeId} not found`);
      }
      const locale = await response.json();
      this.locales[localeId] = locale;
      this.currentLocale = locale;
      return locale;
    } catch (error) {
      console.error('Error loading locale:', error);
      // 回退到默认语言
      if (localeId !== 'zh-CN') {
        return this.loadLocale('zh-CN');
      }
      throw error;
    }
  }

  /**
   * 获取翻译文本
   * @param {string} keyPath - 键路径（如'tabs.start'）
   * @param {Object} [params={}] - 替换参数
   * @returns {string} 翻译文本
   * 
   * @example
   * // 基本用法
   * localeManager.t('tabs.start'); // '开始'
   * 
   * // 带参数
   * localeManager.t('greeting.hello', { name: '张三' }); // '你好，张三'
   */
  t(keyPath, params = {}) {
    if (!this.currentLocale) {
      console.warn('No locale loaded');
      return keyPath;
    }

    const keys = keyPath.split('.');
    let value = this.currentLocale.translations;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        console.warn(`Translation not found for key: ${keyPath}`);
        return keyPath;
      }
    }

    // 替换参数
    if (typeof value === 'string' && Object.keys(params).length > 0) {
      return value.replace(/\{\{(\w+)\}\}/g, (match, param) => {
        return params[param] !== undefined ? params[param] : match;
      });
    }

    return value;
  }

  /**
   * 获取当前语言
   * @returns {Locale|null} 当前语言对象
   */
  getCurrentLocale() {
    return this.currentLocale;
  }

  /**
   * 获取所有已加载语言
   * @returns {Locale[]} 语言数组
   */
  getAvailableLocales() {
    return Object.values(this.locales);
  }
}

/**
 * 语言管理器单例
 * @type {LocaleManager}
 */
window.localeManager = new LocaleManager();
