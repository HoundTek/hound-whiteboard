/**
 * themeManager (REFACTORED)
 * -------------------------
 * ❌ no fs
 * ❌ no fetch fallback
 * ❌ no userDataPath
 * ✔ pure state + rendering layer
 */

class ThemeManager {
  constructor() {
    this.themes = {};
    this.icons = null;

    this.currentTheme = null;
    this.currentIcons = null;

    this.initialized = false;
  }

  // ==============================
  // 🌐 INIT
  // ==============================

  async init(themeId = "default", iconId = "default") {
    const theme = await this.loadTheme(themeId);
    const icons = await this.loadIcons(iconId);

    this.applyTheme(theme);

    this.initialized = true;

    return { theme, icons };
  }

  // ==============================
  // 📦 LOAD (FROM PRELOAD ONLY)
  // ==============================

  async loadTheme(themeId) {
    if (!window?.safeIO?.theme?.loadTheme) {
      throw new Error("safeIO.theme not available");
    }

    const token = window.__THEME_TOKEN__;

    const theme = await window.safeIO.theme.loadTheme(token, themeId);

    this.themes[themeId] = theme;
    this.currentTheme = theme;

    return theme;
  }

  async loadIcons(iconId) {
    if (!window?.safeIO?.theme?.loadIcons) {
      throw new Error("safeIO.theme not available");
    }

    const token = window.__THEME_TOKEN__;

    const icons = await window.safeIO.theme.loadIcons(token, iconId);

    this.currentIcons = icons;

    return icons;
  }

  // ==============================
  // 🎨 APPLY THEME (UI ONLY)
  // ==============================

  applyTheme(theme) {
    const root = document.documentElement;

    const c = theme.colors;
    const f = theme.fonts;

    root.style.setProperty("--primary-color", c.primary);
    root.style.setProperty("--secondary-color", c.secondary);
    root.style.setProperty("--background-color", c.background);
    root.style.setProperty("--surface-color", c.surface);
    root.style.setProperty("--text-color", c.text);
    root.style.setProperty("--text-secondary-color", c.textSecondary);
    root.style.setProperty("--border-color", c.border);
    root.style.setProperty("--hover-color", c.hover);
    root.style.setProperty("--active-color", c.active);
    root.style.setProperty("--active-text-color", c.activeText);

    root.style.setProperty("--font-family", f.family);

    root.style.setProperty("--font-size-small", f.size.small);
    root.style.setProperty("--font-size-medium", f.size.medium);
    root.style.setProperty("--font-size-large", f.size.large);
    root.style.setProperty("--font-size-xlarge", f.size.xlarge);
  }

  // ==============================
  // 🧩 ICON RESOLVE (NO IO)
  // ==============================

  getIcon(name) {
    if (!this.currentIcons?.icons?.[name]) {
      return "default.svg";
    }

    return this.currentIcons.icons[name];
  }

  // ==============================
  // 🔁 SWITCH
  // ==============================

  async switchTheme(themeId) {
    const theme = await this.loadTheme(themeId);
    this.applyTheme(theme);
    return theme;
  }

  async switchIcons(iconId) {
    const icons = await this.loadIcons(iconId);
    return icons;
  }

  // ==============================
  // 📊 STATE
  // ==============================

  getCurrentTheme() {
    return this.currentTheme;
  }

  getCurrentIcons() {
    return this.currentIcons;
  }

  isInitialized() {
    return this.initialized;
  }
}

// ==============================
// 🌉 SINGLETON
// ==============================

window.themeManager = new ThemeManager();

export default window.themeManager;