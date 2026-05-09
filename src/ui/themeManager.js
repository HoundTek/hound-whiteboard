/**
 * themeManager (SIMPLIFIED - works without safeIO)
 */

class ThemeManager {
  constructor() {
    this.themes = {
      default: {
        name: "Default",
        description: "Default theme for Hound Whiteboard",
        colors: {
          primary: "#667eea",
          secondary: "#764ba2",
          background: "#f5f5f5",
          surface: "#ffffff",
          text: "#333333",
          textSecondary: "#666666",
          border: "#e0e0e0",
          hover: "#f0f0f0",
          active: "#667eea",
          activeText: "#ffffff"
        },
        fonts: {
          family: "Arial, sans-serif",
          size: {
            small: "12px",
            medium: "14px",
            large: "16px",
            xlarge: "24px"
          }
        },
        icons: "default"
      },
      dark: {
        name: "Dark",
        description: "Dark theme for Hound Whiteboard",
        colors: {
          primary: "#667eea",
          secondary: "#764ba2",
          background: "#1a1a2e",
          surface: "#16213e",
          text: "#ffffff",
          textSecondary: "#aaaaaa",
          border: "#333344",
          hover: "#2a2a3e",
          active: "#667eea",
          activeText: "#ffffff"
        },
        fonts: {
          family: "Arial, sans-serif",
          size: {
            small: "12px",
            medium: "14px",
            large: "16px",
            xlarge: "24px"
          }
        },
        icons: "default"
      }
    };
    this.currentTheme = this.themes.default;
    this.initialized = true;
  }

  async loadTheme(themeId) {
    const theme = this.themes[themeId] || this.themes.default;
    this.currentTheme = theme;
    this.applyTheme(theme);
    window.dispatchEvent(new Event('themeChanged'));
    return theme;
  }

  async loadIcons(iconId) {
    return { icons: {} };
  }

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

  getIcon(name) {
    return "default.svg";
  }

  getIconPath(name) {
    return "./asset/imgs/" + name + ".svg";
  }

  async switchTheme(themeId) {
    return this.loadTheme(themeId);
  }

  async switchIcons(iconId) {
    return { icons: {} };
  }

  getCurrentTheme() {
    return this.currentTheme;
  }

  getCurrentIcons() {
    return { icons: {} };
  }

  isInitialized() {
    return this.initialized;
  }
}

window.themeManager = new ThemeManager();
