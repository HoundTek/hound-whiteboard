/**
 * @file 主题管理器
 * @description 管理主题和图标包，支持动态切换
 * @module themeManager
 */

/**
 * @typedef {Object} ThemeColors
 * @property {string} primary - 主色
 * @property {string} secondary - 辅助色
 * @property {string} background - 背景色
 * @property {string} surface - 表面色
 * @property {string} text - 文字色
 * @property {string} textSecondary - 次要文字色
 * @property {string} border - 边框色
 * @property {string} hover - 悬停色
 * @property {string} active - 激活色
 * @property {string} activeText - 激活文字色
 */

/**
 * @typedef {Object} ThemeFonts
 * @property {string} family - 字体族
 * @property {Object} size - 字号配置
 * @property {string} size.small - 小字号
 * @property {string} size.medium - 中字号
 * @property {string} size.large - 大字号
 * @property {string} size.xlarge - 超大字号
 */

/**
 * @typedef {Object} Theme
 * @property {string} id - 主题ID
 * @property {string} name - 主题名称
 * @property {ThemeColors} colors - 颜色配置
 * @property {ThemeFonts} fonts - 字体配置
 */

/**
 * @typedef {Object} IconPack
 * @property {string} id - 图标包ID
 * @property {string} name - 图标包名称
 * @property {Object.<string, string>} icons - 图标映射表
 */

/**
 * 主题管理器类
 * @class
 */
class ThemeManager {
  /**
   * 创建主题管理器实例
   */
  constructor() {
    /**
     * 已加载的主题列表
     * @type {Object.<string, Theme>}
     */
    this.themes = {};
    
    /**
     * 当前主题
     * @type {Theme|null}
     */
    this.currentTheme = null;
    
    /**
     * 当前图标包
     * @type {IconPack|null}
     */
    this.currentIcons = null;
    
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
   * 加载主题
   * @async
   * @param {string} themeName - 主题ID
   * @returns {Promise<Theme>} 主题对象
   * @throws {Error} 主题不存在
   */
  async loadTheme(themeName) {
    try {
      const themePath = `${this.userDataPath}/data/themes/${themeName}.json`;
      
      // 优先通过fileUtils加载（IPC）
      if (window.fileUtils) {
        try {
          const theme = await window.fileUtils.readJSON(themePath);
          this.themes[themeName] = theme;
          this.currentTheme = theme;
          this.applyTheme(theme);
          return theme;
        } catch (error) {
          console.warn('Error loading theme via fileUtils, falling back:', error);
        }
      }
      
      // 回退到fetch
      if (this.userDataPath !== './') {
        try {
          const response = await fetch(themePath);
          if (response.ok) {
            const theme = await response.json();
            this.themes[themeName] = theme;
            this.currentTheme = theme;
            this.applyTheme(theme);
            return theme;
          }
        } catch (error) {
          console.warn('Error loading theme from appdata, falling back to local:', error);
        }
      }
      
      // 回退到本地主题目录
      const response = await fetch(`./themes/${themeName}.json`);
      if (!response.ok) {
        throw new Error(`Theme ${themeName} not found`);
      }
      const theme = await response.json();
      this.themes[themeName] = theme;
      this.currentTheme = theme;
      this.applyTheme(theme);
      return theme;
    } catch (error) {
      console.error('Error loading theme:', error);
      // 回退到默认主题
      if (themeName !== 'default') {
        return this.loadTheme('default');
      }
      throw error;
    }
  }

  /**
   * 加载图标包
   * @async
   * @param {string} iconName - 图标包ID
   * @returns {Promise<IconPack>} 图标包对象
   * @throws {Error} 图标包不存在
   */
  async loadIcons(iconName) {
    try {
      const iconPath = `${this.userDataPath}/data/icons/${iconName}/iconpack.json`;
      
      // 优先通过fileUtils加载（IPC）
      if (window.fileUtils) {
        try {
          const icons = await window.fileUtils.readJSON(iconPath);
          this.currentIcons = icons;
          return icons;
        } catch (error) {
          console.warn('Error loading icon pack via fileUtils, falling back:', error);
        }
      }
      
      // 回退到fetch
      if (this.userDataPath !== './') {
        try {
          const response = await fetch(iconPath);
          if (response.ok) {
            const icons = await response.json();
            this.currentIcons = icons;
            return icons;
          }
        } catch (error) {
          console.warn('Error loading icon pack from appdata, falling back to local:', error);
        }
      }
      
      // 回退到本地图标目录
      const response = await fetch(`./icons/${iconName}/iconpack.json`);
      if (!response.ok) {
        throw new Error(`Icon pack ${iconName} not found`);
      }
      const icons = await response.json();
      this.currentIcons = icons;
      return icons;
    } catch (error) {
      console.error('Error loading icon pack:', error);
      // 回退到默认图标包
      if (iconName !== 'default') {
        return this.loadIcons('default');
      }
      throw error;
    }
  }

  /**
   * 获取图标路径
   * @param {string} iconName - 图标名称
   * @returns {string} 图标完整路径
   */
  getIconPath(iconName) {
    if (this.currentIcons && this.currentIcons.icons && this.currentIcons.icons[iconName]) {
      if (this.userDataPath !== './') {
        // 生产环境使用appdata路径
        const iconPackId = this.currentIcons.id || 'default';
        return `${this.userDataPath}/data/icons/${iconPackId}/${this.currentIcons.icons[iconName]}`;
      } else {
        // 开发环境映射到本地资源目录
        const iconPath = this.currentIcons.icons[iconName];
        if (iconPath.startsWith('./')) {
          // 将appdata图标路径映射到本地资源路径
          if (iconPath.includes('/download/')) {
            return `./asset/imgs/download/${iconPath.split('/download/')[1]}`;
          } else {
            return `./asset/imgs/${iconPath.substring(2)}`;
          }
        }
        return iconPath;
      }
    }
    // 回退到默认图标
    if (this.userDataPath !== './') {
      return `${this.userDataPath}/data/icons/default/add.svg`;
    } else {
      return './asset/imgs/add.svg';
    }
  }

  /**
   * 应用主题到应用
   * @param {Theme} theme - 主题对象
   */
  applyTheme(theme) {
    const root = document.documentElement;
    
    // 设置CSS自定义属性
    root.style.setProperty('--primary-color', theme.colors.primary);
    root.style.setProperty('--secondary-color', theme.colors.secondary);
    root.style.setProperty('--background-color', theme.colors.background);
    root.style.setProperty('--surface-color', theme.colors.surface);
    root.style.setProperty('--text-color', theme.colors.text);
    root.style.setProperty('--text-secondary-color', theme.colors.textSecondary);
    root.style.setProperty('--border-color', theme.colors.border);
    root.style.setProperty('--hover-color', theme.colors.hover);
    root.style.setProperty('--active-color', theme.colors.active);
    root.style.setProperty('--active-text-color', theme.colors.activeText);

    // 应用字体
    root.style.setProperty('--font-family', theme.fonts.family);

    // 应用字号
    root.style.setProperty('--font-size-small', theme.fonts.size.small);
    root.style.setProperty('--font-size-medium', theme.fonts.size.medium);
    root.style.setProperty('--font-size-large', theme.fonts.size.large);
    root.style.setProperty('--font-size-xlarge', theme.fonts.size.xlarge);
  }

  /**
   * 获取当前主题
   * @returns {Theme|null} 当前主题对象
   */
  getCurrentTheme() {
    return this.currentTheme;
  }

  /**
   * 获取当前图标包
   * @returns {IconPack|null} 当前图标包对象
   */
  getCurrentIcons() {
    return this.currentIcons;
  }
}

/**
 * 主题管理器单例
 * @type {ThemeManager}
 */
window.themeManager = new ThemeManager();
