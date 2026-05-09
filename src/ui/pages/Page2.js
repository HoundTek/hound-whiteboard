/**
 * @file 设置页面
 * @module pages/Page2
 * @description 功能：
 * - 应用设置页面，包含外观、插件、存档、更新、语言、面板等设置
 */

/**
 * 设置页面组件
 * @param {Object} props 组件属性
 * @param {function} props.onNavigateToAppearance 导航到外观子页面
 * @param {function} props.onNavigateToLanguage 导航到语言子页面
 * @returns {React.ReactElement[]} 页面内容
 */
function Page2({ onNavigateToAppearance, onNavigateToLanguage }) {
  const t = (keyPath, params = {}) => {
    return window.localeManager.t(keyPath, params);
  };
  
  const getIconPath = (iconName) => {
    return window.themeManager.getIconPath(iconName) || './asset/imgs/add.svg';
  };
  
  const breadcrumbItems = [
    { label: t('pages.settings.title'), onClick: () => {} }
  ];
  
  return [
    React.createElement(window.Breadcrumb, { key: 'breadcrumb', items: breadcrumbItems }),
    React.createElement('div', { key: 'button-container', className: 'button-container' }, [
      React.createElement('button', { 
        key: 'btn1', 
        className: 'icon-button',
        onClick: onNavigateToAppearance
      }, [
        React.createElement('img', { key: 'icon1', src: getIconPath('setting'), alt: t('pages.settings.appearance'), className: 'button-icon' }),
        React.createElement('span', { key: 'text1' }, t('pages.settings.appearance'))
      ]),
      React.createElement('button', { key: 'btn2', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon2', src: getIconPath('add'), alt: t('pages.settings.plugins'), className: 'button-icon' }),
        React.createElement('span', { key: 'text2' }, t('pages.settings.plugins'))
      ]),
      React.createElement('button', { key: 'btn3', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon3', src: getIconPath('add'), alt: t('pages.settings.archives'), className: 'button-icon' }),
        React.createElement('span', { key: 'text3' }, t('pages.settings.archives'))
      ]),
      React.createElement('button', { key: 'btn4', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon4', src: getIconPath('add'), alt: t('pages.settings.updates'), className: 'button-icon' }),
        React.createElement('span', { key: 'text4' }, t('pages.settings.updates'))
      ]),
      React.createElement('button', { 
        key: 'btn5', 
        className: 'icon-button',
        onClick: onNavigateToLanguage
      }, [
        React.createElement('img', { key: 'icon5', src: getIconPath('add'), alt: t('pages.settings.language'), className: 'button-icon' }),
        React.createElement('span', { key: 'text5' }, t('pages.settings.language'))
      ]),
      React.createElement('button', { key: 'btn6', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon6', src: getIconPath('add'), alt: t('pages.settings.panels'), className: 'button-icon' }),
        React.createElement('span', { key: 'text6' }, t('pages.settings.panels'))
      ])
    ])
  ];
}

/**
 * 设置页面组件
 * @type {function}
 */
window.Page2 = Page2;
