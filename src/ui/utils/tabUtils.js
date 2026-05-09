/**
 * @file 标签页工具
 * @module utils/tabUtils
 * @description 功能：
 * - 管理底部标签页滑块和悬停效果
 */

const updateTabSlider = () => {
  const tabContainer = document.querySelector('.tab-container');
  const activeButton = document.querySelector('.tab-button.active');
  
  if (tabContainer && activeButton) {
    const containerRect = tabContainer.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    
    const left = buttonRect.left - containerRect.left + 4;
    const width = buttonRect.width - 8;
    
    tabContainer.style.setProperty('--slider-left', `${left}px`);
    tabContainer.style.setProperty('--slider-width', `${width}px`);
  }
};

const addTabButtonHoverListeners = () => {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContainer = document.querySelector('.tab-container');
  
  if (tabButtons && tabContainer) {
    tabButtons.forEach(button => {
      button.addEventListener('mouseenter', () => {
        if (button.classList.contains('active')) {
          tabContainer.classList.add('active-hover');
        }
      });
      
      button.addEventListener('mouseleave', () => {
        tabContainer.classList.remove('active-hover');
      });
    });
    
    return () => {
      tabButtons.forEach(button => {
        button.removeEventListener('mouseenter', () => {});
        button.removeEventListener('mouseleave', () => {});
      });
    };
  }
  
  return () => {};
};

window.tabUtils = {
  updateTabSlider,
  addTabButtonHoverListeners
};
