const FloatingCapsule = ({
  items,
  activeId,
  onChange,
  position = 'bottom',
  threshold = 600,
  className = '',
}) => {
  const [isAttached, setIsAttached] = React.useState(false);
  const [shouldScroll, setShouldScroll] = React.useState(false);
  const [sliderPosition, setSliderPosition] = React.useState({ left: 4, width: 80 });
  const buttonRefs = React.useRef({});
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    const checkWidth = () => {
      const containerWidth = window.innerWidth;
      const requiredWidth = items.length * 90 + 40;
      
      setIsAttached(containerWidth < threshold);
      setShouldScroll(containerWidth < requiredWidth);
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, [items.length, threshold]);

  React.useEffect(() => {
    const updateSlider = () => {
      const activeButton = buttonRefs.current[activeId];
      const container = containerRef.current;
      
      if (activeButton && container) {
        const buttonRect = activeButton.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        setSliderPosition({
          left: buttonRect.left - containerRect.left,
          width: buttonRect.width
        });
      }
    };

    const rafId = requestAnimationFrame(() => {
      updateSlider();
    });
    
    const resizeObserver = new ResizeObserver(updateSlider);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [activeId, isAttached, items]);

  const positionStyle = {
    position: 'fixed',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    zIndex: 1000,
    [position]: 0,
    backgroundColor: isAttached ? 'var(--surface-color, white)' : 'transparent',
  };

  const scrollContainerStyle = {
    display: 'flex',
    overflowX: 'auto',
    overflowY: 'hidden',
    padding: isAttached ? '8px 0' : '8px 24px',
    width: '100%',
    boxSizing: 'border-box',
    justifyContent: shouldScroll ? 'flex-start' : 'center',
  };

  const capsuleStyle = {
    display: 'inline-flex',
    flexShrink: 0,
    backgroundColor: 'var(--surface-color, white)',
    padding: isAttached ? '4px 8px' : '4px',
    borderRadius: isAttached ? 0 : '30px',
    boxShadow: isAttached ? '0 -2px 10px rgba(0, 0, 0, 0.1)' : '0 2px 10px rgba(0, 0, 0, 0.1)',
    borderTop: isAttached ? '1px solid var(--border-color, #ccc)' : '1px solid var(--border-color, #ccc)',
    borderBottom: isAttached ? 'none' : '1px solid var(--border-color, #ccc)',
    borderLeft: isAttached ? 'none' : '1px solid var(--border-color, #ccc)',
    borderRight: isAttached ? 'none' : '1px solid var(--border-color, #ccc)',
    position: 'relative',
    overflow: 'hidden',
    width: isAttached ? '100%' : 'auto',
  };

  const sliderStyle = {
    position: 'absolute',
    top: '4px',
    bottom: '4px',
    left: sliderPosition.left,
    width: sliderPosition.width,
    backgroundColor: 'var(--active-color, #667eea)',
    borderRadius: '26px',
    zIndex: 1,
    transition: 'all 0.3s ease',
  };

  const scrollbarStyle = {
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  };

  const customScrollbarCSS = `
    .floating-capsule-scroll::-webkit-scrollbar {
      display: none;
    }
  `;

  return React.createElement('div', {
    className: `floating-capsule ${className}`,
    style: positionStyle
  }, [
    React.createElement('style', { key: 'scrollbar-style' }, customScrollbarCSS),
    React.createElement('div', {
      key: 'container',
      style: {
        position: 'relative',
        width: '100%',
        maxWidth: isAttached ? '100%' : '800px',
      }
    }, [
      shouldScroll && !isAttached && React.createElement('div', {
        key: 'left-grad',
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '40px',
          background: 'linear-gradient(to right, var(--surface-color, white) 0%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 2,
        }
      }),
      shouldScroll && !isAttached && React.createElement('div', {
        key: 'right-grad',
        style: {
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '40px',
          background: 'linear-gradient(to left, var(--surface-color, white) 0%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 2,
        }
      }),
      React.createElement('div', {
        key: 'scroll',
        className: 'floating-capsule-scroll',
        style: { ...scrollContainerStyle, ...scrollbarStyle }
      }, [
        React.createElement('div', {
          key: 'capsule',
          ref: containerRef,
          style: capsuleStyle
        }, [
          React.createElement('div', {
            key: 'active-slider',
            style: sliderStyle
          }),
          ...items.map(item =>
            React.createElement('button', {
              key: item.id,
              ref: el => buttonRefs.current[item.id] = el,
              onClick: () => onChange(item.id),
              style: {
                flex: '1 0 auto',
                minWidth: '80px',
                padding: '8px 16px',
                border: 'none',
                background: 'transparent',
                color: activeId === item.id ? 'var(--active-text-color, white)' : 'var(--text-color, #333)',
                fontSize: '14px',
                cursor: 'pointer',
                position: 'relative',
                zIndex: 2,
                transition: 'color 0.2s ease',
                whiteSpace: 'nowrap',
              }
            }, item.label)
          )
        ])
      ])
    ])
  ]);
};

window.FloatingCapsule = FloatingCapsule;
