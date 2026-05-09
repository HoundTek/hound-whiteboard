import React from 'react';

const DynamicGrid = ({
  items,
  gap = 20,
  padding = 0,
  cellMinWidth = 150,
  gridWidth = '100%',
  className = '',
  renderItem,
}) => {
  return (
    <div
      className={`dynamic-grid ${className}`}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${typeof cellMinWidth === 'number' ? cellMinWidth + 'px' : cellMinWidth}, 1fr))`,
        gap: gap,
        padding: padding,
        width: gridWidth,
        boxSizing: 'border-box',
      }}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className="dynamic-grid-item"
        >
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
};

export default DynamicGrid;
