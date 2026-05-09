/**
 * @file 面包屑导航组件
 * @module components/Breadcrumb
 * @description 功能：
 * - 显示当前页面层级，支持点击返回上级
 */

/**
 * 面包屑导航组件
 * @param {Object} props 组件属性
 * @param {Array} props.items 面包屑项数组
 * @param {string} props.items[].label 显示文本
 * @param {function} props.items[].onClick 点击回调
 * @returns {React.ReactElement} 面包屑导航元素
 */
function Breadcrumb({ items }) {
  const t = (keyPath, params = {}) => {
    return window.localeManager.t(keyPath, params);
  };
  
  return React.createElement('div', { className: 'breadcrumb' }, 
    items.map((item, index) => 
      React.createElement(React.Fragment, { key: `breadcrumb-${index}` }, [
        React.createElement('button', {
          key: `btn-${index}`,
          className: `breadcrumb-item ${index === items.length - 1 ? 'active' : ''}`,
          onClick: item.onClick,
          disabled: index === items.length - 1
        }, item.label),
        index < items.length - 1 && React.createElement('span', {
          key: `separator-${index}`,
          className: 'breadcrumb-separator'
        }, '>')
      ])
    )
  );
}

/**
 * 面包屑导航组件
 * @type {function}
 */
window.Breadcrumb = Breadcrumb;
