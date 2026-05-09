
const DisplayBox = ({
  children,
  padding = 20,
  borderRadius = 16,
  backgroundColor = 'var(--surface-color, #ffffff)',
  borderColor = 'var(--border-color, #e0e0e0)',
  className = '',
  style = {},
  onClick,
}) => {
  return React.createElement('div', {
    className: `display-box ${className}`,
    style: {
      padding: typeof padding === 'number' ? `${padding}px` : padding,
      borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
      backgroundColor: backgroundColor,
      border: borderColor ? `1px solid ${borderColor}` : 'none',
      boxSizing: 'border-box',
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    },
    onClick: onClick,
  }, children);
};

window.DisplayBox = DisplayBox;
