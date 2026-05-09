const DynamicRowList = ({
  items,
  gap = 16,
  padding = 0,
  itemMinWidth = 120,
  className = '',
  renderItem,
}) => {
  return React.createElement('div', {
    className: `dynamic-row-list ${className}`,
    style: {
      position: 'relative',
      width: '100%',
      boxSizing: 'border-box',
    }
  }, [
    React.createElement('div', {
      key: 'left-gradient',
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '40px',
        background: 'linear-gradient(to right, var(--surface-color, white), transparent)',
        pointerEvents: 'none',
        zIndex: 1,
      }
    }),
    React.createElement('div', {
      key: 'right-gradient',
      style: {
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: '40px',
        background: 'linear-gradient(to left, var(--surface-color, white), transparent)',
        pointerEvents: 'none',
        zIndex: 1,
      }
    }),
    React.createElement('div', {
      key: 'scroll-container',
      style: {
        display: 'flex',
        flexDirection: 'row',
        gap: gap,
        padding: padding,
        paddingLeft: `calc(${padding}px + 30px)`,
        paddingRight: `calc(${padding}px + 30px)`,
        overflowX: 'auto',
        overflowY: 'hidden',
        width: '100%',
        boxSizing: 'border-box',
        scrollbarWidth: 'thin',
      }
    }, items.map((item, index) =>
      React.createElement('div', {
        key: index,
        style: {
          minWidth: typeof itemMinWidth === 'number' ? `${itemMinWidth}px` : itemMinWidth,
          flex: '0 0 auto',
        }
      }, renderItem(item, index))
    ))
  ]);
};

window.DynamicRowList = DynamicRowList;
