// Language subpage component
function LanguageSubpage({ onBack }) {
  const t = (keyPath, params = {}) => {
    // Use localeManager to get translation
    return window.localeManager.t(keyPath, params);
  };
  
  // Get icon path from themeManager
  const getIconPath = (iconName) => {
    return window.themeManager.getIconPath(iconName) || './asset/imgs/add.svg';
  };

  // Available languages
  const languages = [
    { id: 'zh-CN', name: '简体中文', nativeName: '简体中文' },
    { id: 'en-US', name: 'English', nativeName: 'English' }
  ];

  // Current language
  const [currentLanguage, setCurrentLanguage] = React.useState(
    window.userManager.getSetting('locale') || window.localeManager.getCurrentLocale()?.id || 'zh-CN'
  );

  // Load language
  const loadLanguage = async (languageId) => {
    try {
      await window.localeManager.loadLocale(languageId);
      setCurrentLanguage(languageId);
      // Save to user settings
      await window.userManager.setSetting('locale', languageId);
      // Force re-render of the app to apply new language
      window.dispatchEvent(new Event('languageChanged'));
      // Notify other windows
      if (window.electronAPI) {
        window.electronAPI.sendConfigChange({ type: 'locale', value: languageId });
      }
    } catch (error) {
      console.error('Error loading language:', error);
    }
  };

  // Breadcrumb items
  const breadcrumbItems = [
    { label: t('pages.settings.title'), onClick: onBack },
    { label: t('pages.settings.language'), onClick: () => {} }
  ];

  return [
    React.createElement(window.Breadcrumb, { key: 'breadcrumb', items: breadcrumbItems }),

    // Language selection section
    React.createElement('div', { key: 'language-section', className: 'settings-section' }, [
      React.createElement('h2', { key: 'language-title', className: 'section-title' }, t('pages.language.title')),
      React.createElement('div', { key: 'language-options', className: 'options-container' },
        languages.map(language =>
          React.createElement('button', {
            key: language.id,
            className: `option-button ${currentLanguage === language.id ? 'active' : ''}`,
            onClick: () => loadLanguage(language.id)
          }, [
            React.createElement('div', {
              key: `language-preview-${language.id}`,
              className: 'language-preview'
            }, [
              React.createElement('span', {
                key: `language-code-${language.id}`,
                className: 'language-code'
              }, language.id.substring(0, 2).toUpperCase())
            ]),
            React.createElement('span', { key: `language-name-${language.id}` }, language.nativeName)
          ])
        )
      )
    ])
  ];
}

// Export for use in App.js
window.LanguageSubpage = LanguageSubpage;
