// Page 3 component
function Page3() {
  const t = (keyPath, params = {}) => {
    // Use localeManager to get translation
    return window.localeManager.t(keyPath, params);
  };
  
  // Breadcrumb items
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

// Export for use in App.js
window.Page3 = Page3;