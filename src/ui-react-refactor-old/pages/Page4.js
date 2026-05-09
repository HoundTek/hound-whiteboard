/**
 * @file 我的页面
 * @module pages/Page4
 * @description 功能：
 * - 用户个人中心页面，显示用户信息和快捷操作
 */

/**
 * 我的页面组件
 * @returns {React.ReactElement[]} 页面内容
 */
function Page4() {
  const t = (keyPath, params = {}) => {
    return window.localeManager.t(keyPath, params);
  };
  
  const getIconPath = (iconName) => {
    return window.themeManager.getIconPath(iconName) || './asset/imgs/add.svg';
  };
  
  const getUserInfo = () => {
    const user = window.userManager.getCurrentUser();
    return {
      username: user ? user.username : t('user.defaultName'),
      accountType: t('pages.mine.localAccount')
    };
  };
  
  const userInfo = getUserInfo();
  
  const breadcrumbItems = [
    { label: t('pages.mine.title'), onClick: () => {} }
  ];
  
  return [
    React.createElement(window.Breadcrumb, { key: 'breadcrumb', items: breadcrumbItems }),
    
    React.createElement('div', { key: 'user-info', className: 'user-info' }, [
      React.createElement('div', { key: 'avatar', className: 'user-avatar' }, [
        React.createElement('img', {
          key: 'avatar-img',
          src: getIconPath('user'),
          alt: 'Avatar',
          className: 'avatar-img'
        })
      ]),
      React.createElement('div', { key: 'user-details', className: 'user-details' }, [
        React.createElement('h2', { key: 'username', className: 'user-name' }, userInfo.username),
        React.createElement('span', { key: 'account-type', className: 'account-type' }, userInfo.accountType)
      ])
    ]),
    
    React.createElement('div', { key: 'button-container', className: 'button-container' }, [
      React.createElement('button', { key: 'btn1', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon1', src: getIconPath('add'), alt: t('pages.mine.history'), className: 'button-icon' }),
        React.createElement('span', { key: 'text1' }, t('pages.mine.history'))
      ]),
      React.createElement('button', { key: 'btn2', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon2', src: getIconPath('add'), alt: t('pages.mine.favorites'), className: 'button-icon' }),
        React.createElement('span', { key: 'text2' }, t('pages.mine.favorites'))
      ]),
      React.createElement('button', { key: 'btn3', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon3', src: getIconPath('add'), alt: t('pages.mine.cloudService'), className: 'button-icon' }),
        React.createElement('span', { key: 'text3' }, t('pages.mine.cloudService'))
      ]),
      React.createElement('button', { key: 'btn4', className: 'icon-button' }, [
        React.createElement('img', { key: 'icon4', src: getIconPath('add'), alt: t('pages.mine.logout'), className: 'button-icon' }),
        React.createElement('span', { key: 'text4' }, t('pages.mine.logout'))
      ])
    ])
  ];
}

/**
 * 我的页面组件
 * @type {function}
 */
window.Page4 = Page4;
