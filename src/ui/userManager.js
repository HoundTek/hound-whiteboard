/**
 * userManager (SIMPLIFIED - works without safeIO)
 */

class UserManager {
  constructor() {
    this.users = {
      default: {
        id: "default",
        username: "默认用户",
        avatar: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        lastLoginAt: new Date().toISOString(),
        settings: {
          theme: "dark",
          iconPack: "default",
          locale: "zh-CN"
        }
      }
    };
    this.currentUser = this.users.default;
  }

  async loadUser(userId) {
    const user = this.users[userId] || this.users.default;
    this.currentUser = user;
    return user;
  }

  getSetting(key) {
    return this.currentUser?.settings?.[key] ?? null;
  }

  async setSetting(key, value) {
    if (!this.currentUser) return false;
    this.currentUser.settings[key] = value;
    return true;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  async getAllUsers() {
    return Object.values(this.users);
  }

  async updateLastLogin() {
    if (this.currentUser) {
      this.currentUser.lastLoginAt = new Date().toISOString();
    }
  }
}

window.userManager = new UserManager();
