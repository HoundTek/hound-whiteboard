import React from 'react';

const Icon = ({
  src,
  alt = '',
  size = 24,
  className = '',
  style = {},
  onClick,
}) => {
  return (
    <img
      src={src}
      alt={alt}
      className={`icon ${className}`}
      style={{
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        objectFit: 'contain',
        ...style,
      }}
      onClick={onClick}
    />
  );
};

export default Icon;
