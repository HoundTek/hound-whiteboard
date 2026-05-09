
const DynamicGrid = ({
  items,
  gap = 20,
  padding = 0,
  cellMinWidth = 150,
  gridWidth = '100%',
  className = '',
  renderItem,
}) => {
  return React.createElement('div', {
    className: `dynamic-grid ${className}`,
    style: {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${typeof cellMinWidth === 'number' ? cellMinWidth + 'px' : cellMinWidth}, 1fr))`,
      gap: gap,
      padding: padding,
      width: gridWidth,
      boxSizing: 'border-box',
    },
  }, items.map((item, index) =>
    React.createElement('div', {
      key: index,
      className: 'dynamic-grid-item',
    }, renderItem(item, index))
  ));
};

window.DynamicGrid = DynamicGrid;
