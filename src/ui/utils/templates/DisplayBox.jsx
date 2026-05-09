import React from 'react';

const DisplayBox = ({
  children,
  padding = 20,
  borderRadius = 16,
  backgroundColor = 'var(--surface-color)',
  borderColor = 'var(--border-color)',
  className = '',
  style = {},
  onClick,
}) => {
  return (
    <div
      className={`display-box ${className}`}
      style={{
        padding: typeof padding === 'number' ? `${padding}px` : padding,
        borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
        backgroundColor: backgroundColor,
        border: borderColor ? `1px solid ${borderColor}` : 'none',
        boxSizing: 'border-box',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

export default DisplayBox;
