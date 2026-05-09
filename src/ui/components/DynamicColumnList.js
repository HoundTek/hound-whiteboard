
const DynamicColumnList = ({
  items,
  gap = 16,
  padding = 0,
  itemMinHeight = 'auto',
  itemMaxHeight = 'auto',
  className = '',
  renderItem,
}) => {
  return React.createElement('div', {
    className: `dynamic-column-list ${className}`,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: gap,
      padding: padding,
      width: '100%',
      boxSizing: 'border-box',
    },
  }, items.map((item, index) =>
    React.createElement('div', {
      key: index,
      className: 'dynamic-column-item',
      style: {
        minHeight: itemMinHeight,
        maxHeight: itemMaxHeight,
      },
    }, renderItem(item, index))
  ));
};

window.DynamicColumnList = DynamicColumnList;
