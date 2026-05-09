/**
 * @file 帮助页面
 * @module pages/Page3
 * @description 功能：
 * - 应用帮助页面
 */

/**
 * 帮助页面组件
 * @returns {React.ReactElement[]} 页面内容
 */
function Page3() {
  const t = (keyPath, params = {}) => {
    return window.localeManager.t(keyPath, params);
  };
  
  const breadcrumbItems = [
    { label: t('tabs.help'), onClick: () => {} }
  ];
  
  return [
    React.createElement(window.Breadcrumb, { key: 'breadcrumb', items: breadcrumbItems }),
    React.createElement('div', { key: 'button-container', className: 'button-container' }, [
      React.createElement('button', { key: 'btn1', className: 'rounded-button' }, 'Button 3-1'),
      React.createElement('button', { key: 'btn2', className: 'rounded-button' }, 'Button 3-2'),
      React.createElement('button', { key: 'btn3', className: 'rounded-button' }, 'Button 3-3')
    ])
  ];
}

/**
 * 帮助页面组件
 * @type {function}
 */
window.Page3 = Page3;
