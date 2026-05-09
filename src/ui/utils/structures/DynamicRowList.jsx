import React from 'react';

const DynamicRowList = ({
  items,
  gap = 16,
  padding = 0,
  itemMinWidth = 'auto',
  itemMaxWidth = 'auto',
  className = '',
  renderItem,
}) => {
  return (
    <div
      className={`dynamic-row-list ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: gap,
        padding: padding,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className="dynamic-row-item"
          style={{
            minWidth: itemMinWidth,
            maxWidth: itemMaxWidth,
            flex: itemMinWidth === 'auto' ? '0 0 auto' : '1 1 auto',
          }}
        >
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
};

export default DynamicRowList;
