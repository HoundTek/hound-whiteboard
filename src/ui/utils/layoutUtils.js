// Layout utility functions for Hound Whiteboard

/**
 * Calculate optimal columns for button containers based on window width and button count
 */
const calculateOptimalColumns = () => {
  const buttonContainers = document.querySelectorAll('.button-container');
  buttonContainers.forEach(container => {
    const buttonCount = container.querySelectorAll('.icon-button').length;
    if (buttonCount === 0) return;
    
    // Get container width
    const containerWidth = container.offsetWidth;
    
    // Get button width (including margin)
    const firstButton = container.querySelector('.icon-button');
    if (!firstButton) return;
    
    const buttonWidth = firstButton.offsetWidth + 20; // 20px is the gap between buttons
    
    // Calculate maximum possible columns based on container width
    const maxPossibleColumns = Math.floor(containerWidth / buttonWidth);
    
    // Find the largest factor of buttonCount that is <= maxPossibleColumns
    let optimalColumns = 1;
    for (let i = Math.min(maxPossibleColumns, buttonCount); i >= 1; i--) {
      if (buttonCount % i === 0) {
        optimalColumns = i;
        break;
      }
    }
    
    // Ensure at least 1 column
    container.style.setProperty('--columns', Math.max(1, optimalColumns));
  });
};

// Export for global access
window.layoutUtils = {
  calculateOptimalColumns
};
