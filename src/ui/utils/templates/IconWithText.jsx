import React from 'react';
import Icon from './Icon';
import Text from './Text';

const IconWithText = ({
  iconSrc,
  iconAlt = '',
  iconSize = 48,
  text,
  textSize = 'medium',
  textColor = 'default',
  gap = 10,
  className = '',
  onClick,
}) => {
  return (
    <div
      className={`icon-with-text ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: gap,
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
    >
      <Icon src={iconSrc} alt={iconAlt} size={iconSize} />
      <Text size={textSize} color={textColor} align="center">
        {text}
      </Text>
    </div>
  );
};

export default IconWithText;
