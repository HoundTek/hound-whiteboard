/**
 * @file 用户管理器（重构版）
 * @description 纯状态层 + capability API 调用层（无IO权限）
 * @module userManager
 */

/**
 * @typedef {Object} UserSettings
 * @property {string} [theme]
 * @property {string} [iconPack]
 * @property {string} [locale]
 */

/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {UserSettings} settings
 * @property {string} lastLoginAt
 */

class UserManager {
  constructor(api) {
    /**
     * safeIO capability API
     * @type {any}
     */
    this.api = api;

    /**
     * cache users
     * @type {Object.<string, User>}
     */
    this.users = {};

    /**
     * current user
     * @type {User|null}
     */
    this.currentUser = null;
  }

  // ==============================
  // 👤 load user (capability only)
  // ==============================

  /**
   * 加载用户（通过 IPC capability）
   * @param {string} userId
   * @returns {Promise<User>}
   */
  async loadUser(userId) {
    if (!this.api?.user?.load) {
      throw new Error("User API not available");
    }

    const user = await this.api.user.load(userId);

    this.users[userId] = user;
    this.currentUser = user;

    return user;
  }

  // ==============================
  // ⚙️ get setting (pure logic)
  // ==============================

  getSetting(key) {
    return this.currentUser?.settings?.[key] ?? null;
  }

  // ==============================
  // ⚙️ set setting (capability write)
  // ==============================

  /**
   * 修改用户设置（会写回后端）
   */
  async setSetting(key, value) {
    if (!this.currentUser) return false;

    const updated = {
      ...this.currentUser,
      settings: {
        ...this.currentUser.settings,
        [key]: value,
      },
    };

    this.currentUser = updated;
    this.users[updated.id] = updated;

    if (!this.api?.user?.save) {
      throw new Error("User save API not available");
    }

    await this.api.user.save(updated.id, updated);

    return true;
  }

  // ==============================
  // 👤 current user
  // ==============================

  getCurrentUser() {
    return this.currentUser;
  }

  // ==============================
  // 📦 list users (optional capability)
  // ==============================

  async getAllUsers() {
    if (!this.api?.user?.list) {
      return Object.values(this.users);
    }

    const users = await this.api.user.list();
    return users;
  }

  // ==============================
  // ⏱ update login time
  // ==============================

  async updateLastLogin() {
    if (!this.currentUser) return;

    const updated = {
      ...this.currentUser,
      lastLoginAt: new Date().toISOString(),
    };

    this.currentUser = updated;
    this.users[updated.id] = updated;

    if (this.api?.user?.save) {
      await this.api.user.save(updated.id, updated);
    }
  }
}

/**
 * factory（推荐）
 * @param {object} api safeIO bridge
 */
export const createUserManager = (api) => new UserManager(api);