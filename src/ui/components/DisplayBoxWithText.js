
const DisplayBoxWithText = ({
  children,
  text,
  textSize = 'medium',
  textColor = 'inherit',
  gap = 10,
  boxPadding = 20,
  boxBorderRadius = 16,
  boxBackgroundColor = 'var(--surface-color, #ffffff)',
  boxBorderColor = 'var(--border-color, #e0e0e0)',
  className = '',
  onClick,
}) => {
  return React.createElement('div', {
    className: `display-box-with-text ${className}`,
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: gap,
      cursor: onClick ? 'pointer' : 'default',
    },
    onClick: onClick,
  }, [
    window.DisplayBox({
      padding: boxPadding,
      borderRadius: boxBorderRadius,
      backgroundColor: boxBackgroundColor,
      borderColor: boxBorderColor,
      children: children,
    }),
    window.Text({ size: textSize, color: textColor, align: 'center', children: text }),
  ]);
};

window.DisplayBoxWithText = DisplayBoxWithText;
