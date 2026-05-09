/**
 * localeManager (SIMPLIFIED - works without safeIO)
 */

class LocaleManager {
  constructor() {
    this.locales = {
      "zh-CN": {
        id: "zh-CN",
        name: "简体中文",
        nativeName: "简体中文",
        translations: {
          app: {
            title: "Hound Whiteboard"
          },
          tabs: {
            start: "开始",
            settings: "设置",
            help: "帮助",
            mine: "我的"
          },
          pages: {
            start: {
              title: {
                morning: "早上好，",
                noon: "中午好，",
                afternoon: "下午好，",
                evening: "晚上好，"
              },
              quickStart: "快速开始",
              newWhiteboard: "新建白板",
              openWhiteboard: "打开白板",
              startCollaboration: "开始协作"
            },
            settings: {
              title: "设置",
              appearance: "外观",
              plugins: "插件",
              archives: "存档",
              updates: "更新",
              language: "语言",
              panels: "面板"
            },
            appearance: {
              title: "外观",
              back: "返回",
              theme: "主题",
              iconPack: "图标包"
            },
            language: {
              title: "语言",
              back: "返回"
            },
            mine: {
              title: "我的",
              localAccount: "本地账户",
              history: "历史记录",
              favorites: "收藏夹",
              cloudService: "云服务",
              logout: "登出"
            }
          },
          common: {
            confirm: "确认",
            cancel: "取消",
            save: "保存",
            delete: "删除",
            edit: "编辑",
            close: "关闭"
          },
          themes: {
            default: "默认",
            dark: "深色"
          },
          iconPacks: {
            default: "默认"
          },
          user: {
            defaultName: "用户"
          }
        }
      },
      "en-US": {
        id: "en-US",
        name: "English",
        nativeName: "English",
        translations: {
          app: {
            title: "Hound Whiteboard"
          },
          tabs: {
            start: "Start",
            settings: "Settings",
            help: "Help",
            mine: "Mine"
          },
          pages: {
            start: {
              title: {
                morning: "Good morning, ",
                noon: "Good noon, ",
                afternoon: "Good afternoon, ",
                evening: "Good evening, "
              },
              quickStart: "Quick Start",
              newWhiteboard: "New Whiteboard",
              openWhiteboard: "Open Whiteboard",
              startCollaboration: "Start Collaboration"
            },
            settings: {
              title: "Settings",
              appearance: "Appearance",
              plugins: "Plugins",
              archives: "Archives",
              updates: "Updates",
              language: "Language",
              panels: "Panels"
            },
            appearance: {
              title: "Appearance",
              back: "Back",
              theme: "Theme",
              iconPack: "Icon Pack"
            },
            language: {
              title: "Language",
              back: "Back"
            },
            mine: {
              title: "Mine",
              localAccount: "Local Account",
              history: "History",
              favorites: "Favorites",
              cloudService: "Cloud Service",
              logout: "Logout"
            }
          },
          common: {
            confirm: "Confirm",
            cancel: "Cancel",
            save: "Save",
            delete: "Delete",
            edit: "Edit",
            close: "Close"
          },
          themes: {
            default: "Default",
            dark: "Dark"
          },
          iconPacks: {
            default: "Default"
          },
          user: {
            defaultName: "User"
          }
        }
      }
    };
    this.currentLocale = this.locales["zh-CN"];
    this.currentLocaleId = "zh-CN";
    this.initialized = true;
  }

  async init(localeId = "zh-CN") {
    return this.loadLocale(localeId);
  }

  async loadLocale(localeId) {
    const locale = this.locales[localeId] || this.locales["zh-CN"];
    this.currentLocale = locale;
    this.currentLocaleId = localeId;
    window.dispatchEvent(new Event('languageChanged'));
    return locale;
  }

  t(keyPath, params = {}) {
    if (!this.currentLocale) {
      return keyPath;
    }
    const keys = keyPath.split(".");
    let value = this.currentLocale.translations;
    for (const key of keys) {
      if (!value || typeof value !== "object" || !(key in value)) {
        return keyPath;
      }
      value = value[key];
    }
    if (typeof value !== "string") {
      return keyPath;
    }
    if (params && Object.keys(params).length > 0) {
      return value.replace(/\{\{(\w+)\}\}/g, (_, k) =>
        params[k] !== undefined ? params[k] : `{{${k}}}`
      );
    }
    return value;
  }

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

  async switchLocale(localeId) {
    return this.loadLocale(localeId);
  }
}

window.localeManager = new LocaleManager();
