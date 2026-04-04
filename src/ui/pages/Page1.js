// Page 1 component
function Page1() {
  const t = (keyPath, params = {}) => {
    // Use localeManager to get translation
    return window.localeManager.t(keyPath, params);
  };
  
  // Get greeting based on current time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return t('pages.start.title.evening');
    if (hour < 12) return t('pages.start.title.morning');
    if (hour < 14) return t('pages.start.title.noon');
    if (hour < 18) return t('pages.start.title.afternoon');
    return t('pages.start.title.evening');
  };
  
  // Get username from userManager
  const getUsername = () => {
    const user = window.userManager.getCurrentUser();
    return user ? user.username : t('user.defaultName');
  };
  
  // Get icon path from themeManager
  const getIconPath = (iconName) => {
    return window.themeManager.getIconPath(iconName) || './asset/imgs/add.svg';
  };
  
  return [
    React.createElement('h1', { key: 'page-title', className: 'greeting-title' }, `${getGreeting()}${getUsername()}`),
    React.createElement('div', { key: 'button-container', className: 'button-container' }, [
      React.createElement('button', { key: 'btn1', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon1', src: getIconPath('add'), alt: t('pages.start.quickStart'), className: 'button-icon' }),
        React.createElement('span', { key: 'text1' }, t('pages.start.quickStart'))
      ]),
      React.createElement('button', { key: 'btn2', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon2', src: getIconPath('add'), alt: t('pages.start.newWhiteboard'), className: 'button-icon' }),
        React.createElement('span', { key: 'text2' }, t('pages.start.newWhiteboard'))
      ]),
      React.createElement('button', { key: 'btn3', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon3', src: getIconPath('add'), alt: t('pages.start.openWhiteboard'), className: 'button-icon' }),
        React.createElement('span', { key: 'text3' }, t('pages.start.openWhiteboard'))
      ]),
      React.createElement('button', { key: 'btn4', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon4', src: getIconPath('add'), alt: t('pages.start.startCollaboration'), className: 'button-icon' }),
        React.createElement('span', { key: 'text4' }, t('pages.start.startCollaboration'))
      ])
    ])
  ];
}

// Export for use in App.js
window.Page1 = Page1;