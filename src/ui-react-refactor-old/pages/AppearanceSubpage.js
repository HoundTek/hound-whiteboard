/**
 * @file 外观子页面
 * @module pages/AppearanceSubpage
 * @description 功能：
 * - 配置主题和图标包
 */

/**
 * 外观子页面组件
 * @param {Object} props 组件属性
 * @param {function} props.onBack 返回回调
 * @returns {React.ReactElement[]} 页面内容
 */
function AppearanceSubpage({ onBack }) {
  const t = (keyPath, params = {}) => {
    return window.localeManager.t(keyPath, params);
  };
  
  const getIconPath = (iconName) => {
    return window.themeManager.getIconPath(iconName) || './asset/imgs/add.svg';
  };

  // Theme mode options
  const themeModes = [
    { id: 'light', name: '浅色' },
    { id: 'dark', name: '深色' },
    { id: 'system', name: '跟随系统' }
  ];

  // Available themes for each mode
  const lightThemes = [
    { id: 'default', name: '默认浅色', preview: '#ffffff' },
    { id: 'warm', name: '暖色浅色', preview: '#faf5ef' },
    { id: 'cool', name: '冷色浅色', preview: '#f0f5fa' }
  ];

  const darkThemes = [
    { id: 'dark', name: '默认深色', preview: '#1a1a2e' },
    { id: 'midnight', name: '午夜深色', preview: '#0d1117' },
    { id: 'ocean', name: '海洋深色', preview: '#1e2a3a' }
  ];

  // State for current mode and selected themes
  const [currentMode, setCurrentMode] = React.useState(
    window.userManager.getSetting('themeMode') || 'light'
  );
  const [lightTheme, setLightTheme] = React.useState(
    window.userManager.getSetting('lightTheme') || 'default'
  );
  const [darkTheme, setDarkTheme] = React.useState(
    window.userManager.getSetting('darkTheme') || 'dark'
  );
  
  // Mouse menu state
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPosition, setMenuPosition] = React.useState({ x: 0, y: 0 });
  const [selectedItem, setSelectedItem] = React.useState(null);

  // Get current themes based on mode
  const getCurrentThemes = () => {
    if (currentMode === 'dark') {
      return darkThemes;
    }
    return lightThemes;
  };

  // Get current selected theme based on mode
  const getCurrentSelectedTheme = () => {
    if (currentMode === 'dark') {
      return darkTheme;
    }
    return lightTheme;
  };

  // Get theme info by id
  const getThemeById = (themeId, isDark) => {
    const themes = isDark ? darkThemes : lightThemes;
    return themes.find(t => t.id === themeId) || themes[0];
  };

  // Load theme
  const loadTheme = async (themeId) => {
    try {
      await window.themeManager.loadTheme(themeId);
      if (currentMode === 'dark') {
        setDarkTheme(themeId);
        await window.userManager.setSetting('darkTheme', themeId);
      } else {
        setLightTheme(themeId);
        await window.userManager.setSetting('lightTheme', themeId);
      }
      window.dispatchEvent(new Event('themeChanged'));
      if (window.electronAPI) {
        window.electronAPI.sendConfigChange({ type: 'theme', value: themeId });
      }
    } catch (error) {
      console.error('Error loading theme:', error);
    }
  };

  // Change theme mode
  const changeMode = async (mode) => {
    setCurrentMode(mode);
    await window.userManager.setSetting('themeMode', mode);
    
    // Load the appropriate theme based on mode
    const themeToLoad = mode === 'dark' ? darkTheme : lightTheme;
    await loadTheme(themeToLoad);
  };

  // Open mouse menu
  const openMenu = (e, item) => {
    e.stopPropagation();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setSelectedItem(item);
    setMenuOpen(true);
  };

  // Close mouse menu
  const closeMenu = () => {
    setMenuOpen(false);
  };

  // Menu item actions
  const handleEdit = () => {
    console.log('Edit:', selectedItem);
  };

  const handleCopy = () => {
    console.log('Copy:', selectedItem);
  };

  const handleDelete = () => {
    console.log('Delete:', selectedItem);
  };

  // Menu items
  const menuItems = [
    { label: '编辑', onClick: handleEdit },
    { label: '复制', onClick: handleCopy },
    { label: '删除', onClick: handleDelete }
  ];

  // Close menu when clicking outside or scrolling
  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.theme-option') && !e.target.closest('.mouse-menu')) {
        closeMenu();
      }
    };

    const handleScroll = () => {
      closeMenu();
    };

    if (menuOpen) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('scroll', handleScroll, { capture: true });
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [menuOpen]);

  // Update slider position when mode changes
  React.useEffect(() => {
    const container = document.querySelector('.theme-mode-tabs');
    if (container) {
      const activeLabel = container.querySelector('.theme-mode-label.active');
      if (activeLabel) {
        container.style.setProperty('--slider-left', `${activeLabel.offsetLeft}px`);
        container.style.setProperty('--slider-width', `${activeLabel.offsetWidth}px`);
      }
    }
  }, [currentMode]);

  const breadcrumbItems = [
    { label: t('pages.settings.title'), onClick: onBack },
    { label: t('pages.appearance.title'), onClick: () => {} }
  ];

  // Render theme option card
  const renderThemeCard = (theme, isSelected, isReadOnly = false) => {
    return React.createElement('div', {
      key: theme.id,
      className: `theme-option ${isSelected ? 'active' : ''} ${isReadOnly ? 'read-only' : ''}`
    }, [
      React.createElement('div', {
        key: `theme-button-${theme.id}`,
        className: 'theme-option-button'
      }, [
        React.createElement('div', {
          key: `theme-preview-${theme.id}`,
          className: 'theme-preview',
          style: {
            background: theme.preview,
            border: theme.preview.includes('1a1a') || theme.preview.includes('0d') || theme.preview.includes('1e') 
              ? '1px solid #333' 
              : '1px solid #e0e0e0'
          }
        }),
        React.createElement('div', {
          key: `theme-info-${theme.id}`,
          className: 'theme-info'
        }, [
          React.createElement('span', { key: `theme-name-${theme.id}` }, theme.name),
          !isReadOnly && React.createElement('img', {
            key: `theme-check-${theme.id}`,
            src: getIconPath('check'),
            alt: 'selected',
            className: 'theme-check-icon',
            onClick: (e) => openMenu(e, theme)
          })
        ])
      ])
    ]);
  };

  // Render theme selection for light/dark mode
  const renderThemeSelection = () => {
    const currentThemes = getCurrentThemes();
    const currentSelectedTheme = getCurrentSelectedTheme();

    return [
      React.createElement('div', { key: 'theme-description', className: 'theme-description' },
        `选择${currentMode === 'dark' ? '深色' : '浅色'}模式下的主题`
      ),
      React.createElement('div', { key: 'theme-options', className: 'theme-options-container' },
        currentThemes.map(theme => 
          React.createElement('div', {
            key: theme.id,
            className: `theme-option ${currentSelectedTheme === theme.id ? 'active' : ''}`
          }, [
            React.createElement('button', {
              key: `theme-button-${theme.id}`,
              className: 'theme-option-button',
              onClick: (e) => {
                e.stopPropagation();
                loadTheme(theme.id);
              }
            }, [
              React.createElement('div', {
                key: `theme-preview-${theme.id}`,
                className: 'theme-preview',
                style: {
                  background: theme.preview,
                  border: theme.preview.includes('1a1a') || theme.preview.includes('0d') || theme.preview.includes('1e') 
                    ? '1px solid #333' 
                    : '1px solid #e0e0e0'
                }
              }),
              React.createElement('div', {
                key: `theme-info-${theme.id}`,
                className: 'theme-info'
              }, [
                React.createElement('span', { key: `theme-name-${theme.id}` }, theme.name),
                React.createElement('img', {
                  key: `theme-check-${theme.id}`,
                  src: getIconPath('check'),
                  alt: 'selected',
                  className: 'theme-check-icon',
                  onClick: (e) => openMenu(e, theme)
                })
              ])
            ])
          ])
        )
      )
    ];
  };

  // Render system mode info
  const renderSystemModeInfo = () => {
    const selectedLightTheme = getThemeById(lightTheme, false);
    const selectedDarkTheme = getThemeById(darkTheme, true);

    return [
      React.createElement('div', { key: 'system-description', className: 'theme-description system-mode-desc' },
        '跟随系统设置自动切换深色和浅色主题，将使用您在浅色和深色模式下分别选择的主题'
      ),
      React.createElement('div', { key: 'system-themes', className: 'system-themes-container' }, [
        React.createElement('div', { key: 'light-theme-section', className: 'system-theme-section' }, [
          React.createElement('div', { key: 'light-theme-label', className: 'system-theme-label' }, '浅色模式'),
          renderThemeCard(selectedLightTheme, true, true)
        ]),
        React.createElement('div', { key: 'dark-theme-section', className: 'system-theme-section' }, [
          React.createElement('div', { key: 'dark-theme-label', className: 'system-theme-label' }, '深色模式'),
          renderThemeCard(selectedDarkTheme, true, true)
        ])
      ])
    ];
  };

  return [
    React.createElement(window.Breadcrumb, { key: 'breadcrumb', items: breadcrumbItems }),

    React.createElement('div', { key: 'theme-section', className: 'settings-section' }, [
      React.createElement('div', { key: 'theme-header', className: 'theme-header' }, [
        React.createElement('h2', { key: 'theme-title', className: 'section-title' }, t('pages.appearance.theme')),
        React.createElement('div', { 
          key: 'theme-mode-tabs', 
          className: 'theme-mode-tabs',
          ref: (el) => {
            if (el) {
              const activeLabel = el.querySelector('.theme-mode-label.active');
              if (activeLabel) {
                el.style.setProperty('--slider-left', `${activeLabel.offsetLeft}px`);
                el.style.setProperty('--slider-width', `${activeLabel.offsetWidth}px`);
              }
            }
          }
        },
          themeModes.map(mode =>
            React.createElement('label', {
              key: mode.id,
              className: `theme-mode-label ${currentMode === mode.id ? 'active' : ''}`
            }, [
              React.createElement('input', {
                key: `radio-${mode.id}`,
                type: 'radio',
                name: 'themeMode',
                value: mode.id,
                checked: currentMode === mode.id,
                onChange: () => changeMode(mode.id),
                className: 'theme-mode-input'
              }),
              React.createElement('span', { key: `label-${mode.id}`, className: 'theme-mode-text' }, mode.name)
            ])
          )
        )
      ]),
      ...(currentMode === 'system' ? renderSystemModeInfo() : renderThemeSelection())
    ]),

    React.createElement(window.MouseMenu, {
      key: 'mouse-menu',
      isOpen: menuOpen,
      x: menuPosition.x,
      y: menuPosition.y,
      items: menuItems,
      onClose: closeMenu
    })
  ];
}

/**
 * 外观子页面组件
 * @type {function}
 */
window.AppearanceSubpage = AppearanceSubpage;
