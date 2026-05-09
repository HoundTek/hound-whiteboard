/**
 * @file 语言子页面
 * @module pages/LanguageSubpage
 * @description 功能：
 * - 配置应用语言
 */

/**
 * 语言子页面组件
 * @param {Object} props 组件属性
 * @param {function} props.onBack 返回回调
 * @returns {React.ReactElement[]} 页面内容
 */
function LanguageSubpage({ onBack }) {
  const t = (keyPath, params = {}) => {
    return window.localeManager.t(keyPath, params);
  };
  
  const getIconPath = (iconName) => {
    return window.themeManager.getIconPath(iconName) || './asset/imgs/add.svg';
  };

  const languages = [
    { id: 'zh-CN', name: '简体中文', nativeName: '简体中文' },
    { id: 'en-US', name: 'English', nativeName: 'English' }
  ];

  const [currentLanguage, setCurrentLanguage] = React.useState(
    window.userManager.getSetting('locale') || window.localeManager.getCurrentLocale()?.id || 'zh-CN'
  );

  const loadLanguage = async (languageId) => {
    try {
      await window.localeManager.loadLocale(languageId);
      setCurrentLanguage(languageId);
      await window.userManager.setSetting('locale', languageId);
      window.dispatchEvent(new Event('languageChanged'));
      if (window.electronAPI) {
        window.electronAPI.sendConfigChange({ type: 'locale', value: languageId });
      }
    } catch (error) {
      console.error('Error loading language:', error);
    }
  };

  const breadcrumbItems = [
    { label: t('pages.settings.title'), onClick: onBack },
    { label: t('pages.settings.language'), onClick: () => {} }
  ];

  return [
    React.createElement(window.Breadcrumb, { key: 'breadcrumb', items: breadcrumbItems }),

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

/**
 * 语言子页面组件
 * @type {function}
 */
window.LanguageSubpage = LanguageSubpage;
