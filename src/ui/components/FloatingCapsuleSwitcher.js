const FloatingCapsuleSwitcher = ({
  options = [],
  value,
  onChange,
  className = '',
}) => {
  const [isAttached, setIsAttached] = React.useState(false);

  React.useEffect(() => {
    const checkWidth = () => {
      const requiredWidth = options.length * 80;
      setIsAttached(window.innerWidth < requiredWidth * 2);
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, [options.length]);

  const buttons = options.map((option, idx) =>
    React.createElement('button', {
      key: option.value,
      onClick: () => onChange(option.value),
      style: {
        flex: 1,
        padding: '6px 14px',
        border: 'none',
        background: 'transparent',
        color: option.value === value ? 'var(--active-text-color, white)' : 'var(--text-color, #333)',
        fontSize: '14px',
        cursor: 'pointer',
        position: 'relative',
        zIndex: 2,
        transition: 'color 0.2s ease',
        whiteSpace: 'nowrap',
      }
    }, option.label)
  );

  return React.createElement('div', {
    className: `floating-capsule-switcher ${className}`,
    style: {
      position: isAttached ? 'fixed' : 'relative',
      bottom: isAttached ? 0 : 'auto',
      left: isAttached ? 0 : 'auto',
      right: isAttached ? 0 : 'auto',
      display: 'flex',
      gap: 0,
      backgroundColor: 'var(--surface-color, white)',
      padding: '4px',
      borderRadius: isAttached ? '16px 16px 0 0' : '30px',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
      border: '1px solid var(--border-color, #ccc)',
      overflow: 'hidden',
      zIndex: isAttached ? 1000 : 'auto',
    }
  }, [
    React.createElement('div', {
      key: 'slider',
      style: {
        position: 'absolute',
        top: '4px',
        bottom: '4px',
        left: `calc(4px + ${options.findIndex(opt => opt.value === value)} * (100% - 8px) / ${options.length})`,
        width: `calc((100% - 8px) / ${options.length})`,
        backgroundColor: 'var(--active-color, #667eea)',
        borderRadius: isAttached ? '12px 12px 0 0' : '26px',
        zIndex: 1,
        transition: 'all 0.3s ease',
      }
    }),
    ...buttons
  ]);
};

window.FloatingCapsuleSwitcher = FloatingCapsuleSwitcher;
