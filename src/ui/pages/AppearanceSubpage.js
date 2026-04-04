// Appearance subpage component
function AppearanceSubpage({ onBack }) {
  const t = (keyPath, params = {}) => {
    // Use localeManager to get translation
    return window.localeManager.t(keyPath, params);
  };
  
  // Get icon path from themeManager
  const getIconPath = (iconName) => {
    return window.themeManager.getIconPath(iconName) || './asset/imgs/add.svg';
  };

  // Theme options
  const themes = [
    { id: 'default', name: t('themes.default') || '默认', icon: 'add' },
    { id: 'dark', name: t('themes.dark') || '深色', icon: 'add' }
  ];

  // Icon pack options
  const iconPacks = [
    { id: 'default', name: t('iconPacks.default') || '默认', icon: 'add' }
  ];

  // Current theme and icon pack
  const [currentTheme, setCurrentTheme] = React.useState(
    window.userManager.getSetting('theme') || 'default'
  );
  const [currentIconPack, setCurrentIconPack] = React.useState(
    window.userManager.getSetting('iconPack') || 'default'
  );

  // Load theme
  const loadTheme = async (themeId) => {
    try {
      await window.themeManager.loadTheme(themeId);
      setCurrentTheme(themeId);
      // Save to user settings
      await window.userManager.setSetting('theme', themeId);
      // Notify current window
      window.dispatchEvent(new Event('themeChanged'));
      // Notify other windows
      if (window.electronAPI) {
        window.electronAPI.sendConfigChange({ type: 'theme', value: themeId });
      }
    } catch (error) {
      console.error('Error loading theme:', error);
    }
  };

  // Load icon pack
  const loadIconPack = async (iconPackId) => {
    try {
      await window.themeManager.loadIcons(iconPackId);
      setCurrentIconPack(iconPackId);
      // Save to user settings
      await window.userManager.setSetting('iconPack', iconPackId);
      // Notify current window
      window.dispatchEvent(new Event('themeChanged'));
      // Notify other windows
      if (window.electronAPI) {
        window.electronAPI.sendConfigChange({ type: 'iconPack', value: iconPackId });
      }
    } catch (error) {
      console.error('Error loading icon pack:', error);
    }
  };

  // Breadcrumb items
  const breadcrumbItems = [
    { label: t('pages.settings.title'), onClick: onBack },
    { label: t('pages.appearance.title'), onClick: () => {} }
  ];

  return [
    React.createElement(window.Breadcrumb, { key: 'breadcrumb', items: breadcrumbItems }),

    // Theme selection section
    React.createElement('div', { key: 'theme-section', className: 'settings-section' }, [
      React.createElement('h2', { key: 'theme-title', className: 'section-title' }, t('pages.appearance.theme')),
      React.createElement('div', { key: 'theme-options', className: 'options-container' },
        themes.map(theme =>
          React.createElement('button', {
            key: theme.id,
            className: `option-button ${currentTheme === theme.id ? 'active' : ''}`,
            onClick: () => loadTheme(theme.id)
          }, [
            React.createElement('div', {
              key: `theme-preview-${theme.id}`,
              className: 'theme-preview',
              style: {
                background: theme.id === 'dark' ? '#333' : '#fff',
                border: theme.id === 'dark' ? '1px solid #666' : '1px solid #e0e0e0'
              }
            }),
            React.createElement('span', { key: `theme-name-${theme.id}` }, theme.name)
          ])
        )
      )
    ]),

    // Icon pack selection section
    React.createElement('div', { key: 'icon-section', className: 'settings-section' }, [
      React.createElement('h2', { key: 'icon-title', className: 'section-title' }, t('pages.appearance.iconPack')),
      React.createElement('div', { key: 'icon-options', className: 'options-container' },
        iconPacks.map(iconPack =>
          React.createElement('button', {
            key: iconPack.id,
            className: `option-button ${currentIconPack === iconPack.id ? 'active' : ''}`,
            onClick: () => loadIconPack(iconPack.id)
          }, [
            React.createElement('div', {
              key: `icon-preview-${iconPack.id}`,
              className: 'icon-preview'
            }, [
              React.createElement('img', {
                key: `icon-pack-preview-${iconPack.id}`,
                src: getIconPath('add'),
                alt: iconPack.name,
                className: 'preview-icon'
              })
            ]),
            React.createElement('span', { key: `icon-name-${iconPack.id}` }, iconPack.name)
          ])
        )
      )
    ])
  ];
}

// Export for use in App.js
window.AppearanceSubpage = AppearanceSubpage;
