import React from 'react';
import DisplayBox from './DisplayBox';
import Text from './Text';

const DisplayBoxWithText = ({
  children,
  text,
  textSize = 'medium',
  textColor = 'default',
  gap = 10,
  boxPadding = 20,
  boxBorderRadius = 16,
  boxBackgroundColor = 'var(--surface-color)',
  boxBorderColor = 'var(--border-color)',
  className = '',
  onClick,
}) => {
  return (
    <div
      className={`display-box-with-text ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: gap,
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
    >
      <DisplayBox
        padding={boxPadding}
        borderRadius={boxBorderRadius}
        backgroundColor={boxBackgroundColor}
        borderColor={boxBorderColor}
      >
        {children}
      </DisplayBox>
      <Text size={textSize} color={textColor} align="center">
        {text}
      </Text>
    </div>
  );
};

export default DisplayBoxWithText;
