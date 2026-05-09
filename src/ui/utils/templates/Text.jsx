import React from 'react';

const Text = ({
  children,
  size = 'medium',
  color = 'default',
  weight = 'normal',
  align = 'left',
  className = '',
  style = {},
  tag = 'span',
}) => {
  const sizeMap = {
    small: '12px',
    medium: '14px',
    large: '16px',
    xlarge: '24px',
  };

  const weightMap = {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  };

  const Tag = tag;

  return (
    <Tag
      className={`text ${className}`}
      style={{
        fontSize: sizeMap[size] || size,
        fontWeight: weightMap[weight] || weight,
        textAlign: align,
        color: color,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
};

export default Text;
