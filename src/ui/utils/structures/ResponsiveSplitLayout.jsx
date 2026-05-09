import React, { useMemo, useState, useEffect } from 'react';

const ResponsiveSplitLayout = ({
  leftContent,
  rightContent,
  threshold = 768,
  gap = 24,
  horizontalRatio = [1, 1],
  className = '',
}) => {
  const [isVertical, setIsVertical] = useState(false);

  useEffect(() => {
    const checkWidth = () => {
      setIsVertical(window.innerWidth < threshold);
    };

    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, [threshold]);

  const layoutStyle = useMemo(() => {
    if (isVertical) {
      return {
        display: 'flex',
        flexDirection: 'column',
        gap: gap,
      };
    }
    return {
      display: 'flex',
      flexDirection: 'row',
      gap: gap,
      width: '100%',
    };
  }, [isVertical, gap]);

  const leftStyle = useMemo(() => {
    if (isVertical) {
      return {};
    }
    return {
      flex: horizontalRatio[0],
      minWidth: 0,
    };
  }, [isVertical, horizontalRatio]);

  const rightStyle = useMemo(() => {
    if (isVertical) {
      return {};
    }
    return {
      flex: horizontalRatio[1],
      minWidth: 0,
    };
  }, [isVertical, horizontalRatio]);

  return (
    <div className={`responsive-split-layout ${className}`} style={layoutStyle}>
      <div className="responsive-split-left" style={leftStyle}>
        {leftContent}
      </div>
      <div className="responsive-split-right" style={rightStyle}>
        {rightContent}
      </div>
    </div>
  );
};

export default ResponsiveSplitLayout;
