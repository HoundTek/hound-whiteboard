const MenuButton = ({
  children,
  text,
  menuItems = [],
  textSize = 'medium',
  textColor = 'inherit',
  gap = 10,
  boxPadding = 20,
  boxBorderRadius = 16,
  boxBackgroundColor = 'var(--surface-color, #ffffff)',
  boxBorderColor = 'var(--border-color, #e0e0e0)',
  className = '',
  onMenuItemClick,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    const handleClickOutside = () => setMenuOpen(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleMenuItemClick = (item, index, e) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (onMenuItemClick) {
      onMenuItemClick(item, index);
    }
  };

  const textSizeMap = {
    small: '12px',
    medium: '14px',
    large: '16px',
  };

  return React.createElement('div', {
    className: `menu-button-container ${className}`,
    style: { position: 'relative' }
  }, [
    React.createElement('div', {
      key: 'button',
      style: { display: 'flex', flexDirection: 'column', gap: gap }
    }, [
      window.DisplayBox({
        padding: boxPadding,
        borderRadius: boxBorderRadius,
        backgroundColor: boxBackgroundColor,
        borderColor: boxBorderColor,
        children: children,
      }),
      React.createElement('div', {
        key: 'text-row',
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }
      }, [
        React.createElement('span', {
          key: 'text',
          style: {
            fontSize: textSizeMap[textSize] || textSize,
            color: textColor,
            textAlign: 'left',
            flex: 1,
          }
        }, text),
        React.createElement('button', {
          key: 'menu-toggle',
          onClick: (e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          },
          style: {
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            borderRadius: '4px',
          }
        }, '⋯'),
      ]),
    ]),
    menuOpen && React.createElement('div', {
      key: 'dropdown',
      style: {
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: '4px',
        backgroundColor: 'var(--surface-color, white)',
        border: '1px solid var(--border-color, #ccc)',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
        zIndex: 1000,
        minWidth: '160px',
        overflow: 'hidden',
      }
    }, menuItems.map((item, index) =>
      React.createElement('button', {
        key: index,
        onClick: (e) => handleMenuItemClick(item, index, e),
        style: {
          display: 'block',
          width: '100%',
          padding: '10px 16px',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-color, #333)',
          fontSize: '14px',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'background-color 0.2s ease',
        },
        onMouseEnter: (e) => { e.target.style.backgroundColor = 'var(--hover-color, #f0f0f0)'; },
        onMouseLeave: (e) => { e.target.style.backgroundColor = 'transparent'; },
      }, item.label)
    )),
  ]);
};

window.MenuButton = MenuButton;
