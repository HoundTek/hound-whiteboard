
const IconWithText = ({
  iconSrc,
  iconAlt = '',
  iconSize = 48,
  text,
  textSize = 'medium',
  textColor = 'inherit',
  gap = 10,
  className = '',
  onClick,
}) => {
  return React.createElement('div', {
    className: `icon-with-text ${className}`,
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: gap,
      cursor: onClick ? 'pointer' : 'default',
    },
    onClick: onClick,
  }, [
    window.Icon({ src: iconSrc, alt: iconAlt, size: iconSize }),
    window.Text({ size: textSize, color: textColor, align: 'center', children: text }),
  ]);
};

window.IconWithText = IconWithText;
