import React, { useState, useEffect, useRef } from 'react';

const FloatingCapsuleSwitcher = ({
  options = [],
  value,
  onChange,
  className = '',
}) => {
  const [isAttached, setIsAttached] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const checkWidth = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const parentWidth = containerRef.current.parentElement.offsetWidth;
        setIsAttached(containerWidth > parentWidth * 0.9);
      }
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const activeIndex = options.findIndex(opt => opt.value === value);

  const containerStyle = {
    position: 'relative',
    display: 'flex',
    gap: 0,
    backgroundColor: 'var(--surface-color)',
    padding: 4,
    borderRadius: isAttached ? '16px 16px 0 0' : '30px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
    border: '1px solid var(--border-color)',
    overflow: 'hidden',
    ...(isAttached ? {
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      borderRadius: '16px 16px 0 0',
      zIndex: 1000,
    } : {}),
  };

  const sliderStyle = {
    content: '',
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    width: '100px',
    backgroundColor: 'var(--active-color)',
    borderRadius: isAttached ? '12px 12px 0 0' : '26px',
    zIndex: 1,
    transition: 'all 0.3s ease',
  };

  return (
    <div ref={containerRef} className={`floating-capsule-switcher ${className}`} style={containerStyle}>
      {activeIndex >= 0 && (
        <div
          className="switcher-slider"
          style={{
            ...sliderStyle,
            left: `calc(4px + ${activeIndex} * (100% - 8px) / ${options.length})`,
            width: `calc((100% - 8px) / ${options.length})`,
          }}
        />
      )}

      {options.map((option, index) => (
        <button
          key={option.value}
          className={`switcher-option ${option.value === value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
          style={{
            flex: 1,
            padding: '6px 14px',
            border: 'none',
            background: 'transparent',
            color: option.value === value ? 'var(--active-text-color)' : 'var(--text-color)',
            fontSize: '12px',
            cursor: 'pointer',
            position: 'relative',
            zIndex: 2,
            transition: 'color 0.2s ease',
            whiteSpace: 'nowrap',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

export default FloatingCapsuleSwitcher;
