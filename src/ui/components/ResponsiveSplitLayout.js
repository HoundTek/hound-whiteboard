const ResponsiveSplitLayout = ({
  leftContent,
  rightContent,
  threshold = 768,
  gap = 24,
  horizontalRatio = [1, 1],
  className = '',
}) => {
  const [isVertical, setIsVertical] = React.useState(false);

  React.useEffect(() => {
    const checkWidth = () => {
      setIsVertical(window.innerWidth < threshold);
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, [threshold]);

  // 垂直布局时需要让整个容器可滚动
  const containerStyle = React.useMemo(() => {
    if (isVertical) {
      return {
        display: 'flex',
        flexDirection: 'column',
        gap: gap,
        height: '100%',
        width: '100%',
        overflowY: 'auto',
        paddingBottom: '72px',
        boxSizing: 'border-box',
      };
    }
    return {
      display: 'flex',
      flexDirection: 'row',
      height: '100%',
      width: '100%',
    };
  }, [isVertical, gap]);

  const leftStyle = React.useMemo(() => {
    if (isVertical) {
      return {
        flex: 'none',
        minHeight: 'auto',
        overflowY: 'visible',
        width: '100%',
      };
    }
    return {
      flex: horizontalRatio[0],
      minWidth: 0,
      height: '100%',
      overflowY: 'auto',
      position: 'relative',
      paddingBottom: '72px',
      boxSizing: 'border-box',
    };
  }, [isVertical, horizontalRatio]);

  const rightStyle = React.useMemo(() => {
    if (isVertical) {
      return {
        flex: 'none',
        minHeight: 'auto',
        overflowY: 'visible',
        width: '100%',
      };
    }
    return {
      flex: horizontalRatio[1],
      minWidth: 0,
      height: '100%',
      overflowY: 'auto',
      position: 'relative',
      paddingBottom: '72px',
      boxSizing: 'border-box',
    };
  }, [isVertical, horizontalRatio]);

  const dividerStyle = {
    width: '1px',
    backgroundColor: 'var(--border-color, #e0e0e0)',
    flexShrink: 0,
    margin: '0',
  };

  const scrollbarStyle = {
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--border-color, #c0c0c0) var(--surface-color, #f5f5f5)',
  };

  const customScrollbarCSS = `
    .responsive-split-left::-webkit-scrollbar,
    .responsive-split-right::-webkit-scrollbar {
      width: 8px;
    }
    
    .responsive-split-left::-webkit-scrollbar-track,
    .responsive-split-right::-webkit-scrollbar-track {
      background: var(--surface-color, #f5f5f5);
      border-radius: 4px;
    }
    
    .responsive-split-left::-webkit-scrollbar-thumb,
    .responsive-split-right::-webkit-scrollbar-thumb {
      background: var(--border-color, #c0c0c0);
      border-radius: 4px;
    }
    
    .responsive-split-left::-webkit-scrollbar-thumb:hover,
    .responsive-split-right::-webkit-scrollbar-thumb:hover {
      background: var(--text-color, #999);
    }
  `;

  return React.createElement('div', {
    className: `responsive-split-layout ${className}`,
    style: containerStyle
  }, [
    React.createElement('style', { key: 'scrollbar-style' }, customScrollbarCSS),
    React.createElement('div', {
      key: 'left',
      className: 'responsive-split-left',
      style: { ...leftStyle, ...scrollbarStyle }
    }, leftContent),
    !isVertical && React.createElement('div', {
      key: 'divider',
      style: dividerStyle
    }),
    React.createElement('div', {
      key: 'right',
      className: 'responsive-split-right',
      style: { ...rightStyle, ...scrollbarStyle }
    }, rightContent)
  ]);
};

window.ResponsiveSplitLayout = ResponsiveSplitLayout;
