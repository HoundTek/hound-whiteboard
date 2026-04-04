// Tab utility functions for Hound Whiteboard

/**
 * Update tab slider position and size
 */
const updateTabSlider = () => {
  const tabContainer = document.querySelector('.tab-container');
  const activeButton = document.querySelector('.tab-button.active');
  
  if (tabContainer && activeButton) {
    const containerRect = tabContainer.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    
    // Calculate relative position and size
    const left = buttonRect.left - containerRect.left + 4; // 4px offset
    const width = buttonRect.width - 8; // 4px offset on each side
    
    // Update slider position and size
    tabContainer.style.setProperty('--slider-left', `${left}px`);
    tabContainer.style.setProperty('--slider-width', `${width}px`);
  }
};

/**
 * Add event listeners for tab button hover
 */
const addTabButtonHoverListeners = () => {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContainer = document.querySelector('.tab-container');
  
  if (tabButtons && tabContainer) {
    // Add hover event listeners
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
    
    // Return cleanup function
    return () => {
      tabButtons.forEach(button => {
        button.removeEventListener('mouseenter', () => {});
        button.removeEventListener('mouseleave', () => {});
      });
    };
  }
  
  return () => {};
};

// Export for global access
window.tabUtils = {
  updateTabSlider,
  addTabButtonHoverListeners
};
