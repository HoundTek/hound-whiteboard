// Breadcrumb navigation component
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

// Export for use in other components
window.Breadcrumb = Breadcrumb;
