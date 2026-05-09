import React, { useState, useRef, useEffect } from 'react';
import DisplayBox from './DisplayBox';
import Text from './Text';

const MenuButton = ({
  children,
  text,
  menuItems = [],
  textSize = 'medium',
  textColor = 'default',
  gap = 10,
  boxPadding = 20,
  boxBorderRadius = 16,
  boxBackgroundColor = 'var(--surface-color)',
  boxBorderColor = 'var(--border-color)',
  className = '',
  onMenuItemClick,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMenuItemClick = (item, index) => {
    setMenuOpen(false);
    if (onMenuItemClick) {
      onMenuItemClick(item, index);
    }
  };

  return (
    <div className={`menu-button-container ${className}`}>
      <div
        ref={buttonRef}
        className="menu-button"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: gap,
          cursor: 'pointer',
        }}
      >
        <DisplayBox
          padding={boxPadding}
          borderRadius={boxBorderRadius}
          backgroundColor={boxBackgroundColor}
          borderColor={boxBorderColor}
        >
          {children}
        </DisplayBox>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text size={textSize} color={textColor}>{text}</Text>
          <button
            className="menu-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: '20px' }}>⋯</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="menu-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            backgroundColor: 'var(--surface-color)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
            minWidth: 180,
            overflow: 'hidden',
          }}
        >
          {menuItems.map((item, index) => (
            <button
              key={index}
              className="menu-item"
              onClick={() => handleMenuItemClick(item, index)}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 16px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-color)',
                fontSize: '14px',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MenuButton;
