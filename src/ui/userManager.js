/**
 * @file 用户管理器
 * @description 管理用户配置和设置，支持多用户
 * @module userManager
 */

/**
 * @typedef {Object} UserSettings
 * @property {string} [theme] - 主题ID
 * @property {string} [iconPack] - 图标包ID
 * @property {string} [locale] - 语言ID
 */

/**
 * @typedef {Object} User
 * @property {string} id - 用户ID
 * @property {string} name - 用户名
 * @property {string} type - 用户类型（local）
 * @property {UserSettings} settings - 用户设置
 * @property {string} lastLoginAt - 最后登录时间
 */

/**
 * 用户管理器类
 * @class
 */
class UserManager {
  /**
   * 创建用户管理器实例
   */
  constructor() {
    /**
     * 已加载的用户列表
     * @type {Object.<string, User>}
     */
    this.users = {};
    
    /**
     * 当前用户
     * @type {User|null}
     */
    this.currentUser = null;
    
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
   * 加载用户配置
   * @async
   * @param {string} userId - 用户ID
   * @returns {Promise<User>} 用户对象
   * @throws {Error} 用户不存在
   */
  async loadUser(userId) {
    try {
      const profilePath = `${this.userDataPath}/data/users/${userId}/profile.json`;
      
      // 优先通过fileUtils加载（IPC）
      if (window.fileUtils) {
        try {
          const user = await window.fileUtils.readJSON(profilePath);
          this.users[userId] = user;
          this.currentUser = user;
          return user;
        } catch (error) {
          console.warn('Error loading user via fileUtils, falling back:', error);
        }
      }
      
      // 回退到fetch
      if (this.userDataPath !== './') {
        try {
          const response = await fetch(profilePath);
          if (response.ok) {
            const user = await response.json();
            this.users[userId] = user;
            this.currentUser = user;
            return user;
          }
        } catch (error) {
          console.warn('Error loading user from appdata, falling back to local:', error);
        }
      }
      
      // 回退到本地用户目录
      const response = await fetch(`./users/${userId}/profile.json`);
      if (!response.ok) {
        throw new Error(`User ${userId} not found`);
      }
      const user = await response.json();
      this.users[userId] = user;
      this.currentUser = user;
      return user;
    } catch (error) {
      console.error('Error loading user:', error);
      // 回退到默认用户
      if (userId !== 'default') {
        return this.loadUser('default');
      }
      throw error;
    }
  }

  /**
   * 获取用户设置
   * @param {string} key - 设置键名
   * @returns {*} 设置值
   */
  getSetting(key) {
    if (this.currentUser && this.currentUser.settings) {
      return this.currentUser.settings[key];
    }
    return null;
  }

  /**
   * 设置用户配置并保存到文件
   * @async
   * @param {string} key - 设置键名
   * @param {*} value - 设置值
   * @returns {Promise<boolean>} 是否成功
   */
  async setSetting(key, value) {
    if (this.currentUser) {
      this.currentUser.settings[key] = value;
      
      // 通过fileUtils保存到文件
      if (window.fileUtils) {
        try {
          const userId = this.currentUser.id || 'default';
          const profilePath = `${this.userDataPath}/data/users/${userId}/profile.json`;
          await window.fileUtils.writeJSON(profilePath, this.currentUser);
        } catch (error) {
          console.error('Error saving user settings:', error);
        }
      }
      
      return true;
    }
    return false;
  }

  /**
   * 获取当前用户
   * @returns {User|null} 当前用户对象
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * 获取所有已加载用户
   * @returns {User[]} 用户数组
   */
  getAllUsers() {
    return Object.values(this.users);
  }

  /**
   * 更新最后登录时间
   */
  updateLastLogin() {
    if (this.currentUser) {
      this.currentUser.lastLoginAt = new Date().toISOString();
    }
  }
}

/**
 * 用户管理器单例
 * @type {UserManager}
 */
window.userManager = new UserManager();
