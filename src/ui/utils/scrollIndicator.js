// Scroll indicator utility functions for Hound Whiteboard

// Track if scroll indicator is being dragged
let isDragging = false;

/**
 * Update scroll indicator position and size
 */
const updateScrollIndicator = () => {
  // Skip update if currently dragging to avoid interference
  if (isDragging) return;
  
  const scrollIndicator = document.getElementById('scroll-indicator');
  if (!scrollIndicator) return;
  
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;
  const scrollTop = document.documentElement.scrollTop;
  
  // Calculate if page is scrollable
  const isScrollable = scrollHeight > clientHeight + 1;
  
  if (isScrollable) {
    // Calculate handle size with a more reasonable algorithm
    // Handle height should be proportional to the viewport height relative to total content height
    // But also have a minimum and maximum size
    const handleHeightRatio = Math.min(0.5, Math.max(0.1, clientHeight / scrollHeight));
    const handleHeight = handleHeightRatio * 100; // Convert to percentage
    
    // Calculate handle position considering the handle height
    const maxScrollTop = scrollHeight - clientHeight;
    const maxHandleTop = 100 - handleHeight;
    const handleTop = (scrollTop / maxScrollTop) * maxHandleTop;
    
    scrollIndicator.style.display = 'block';
    scrollIndicator.style.setProperty('--handle-height', `${handleHeight}%`);
    scrollIndicator.style.setProperty('--handle-top', `${handleTop}%`);
  } else {
    scrollIndicator.style.display = 'none';
  }
};

/**
 * Initialize scroll indicator drag functionality
 */
const initScrollIndicatorDrag = () => {
  const scrollIndicator = document.getElementById('scroll-indicator');
  if (!scrollIndicator) return;
  
  let mouseOffset = 0; // Mouse offset relative to the top of the handle
  
  scrollIndicator.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.userSelect = 'none';
    // Add dragging class
    scrollIndicator.classList.add('dragging');
    
    // Calculate mouse offset relative to the top of the handle
    const rect = scrollIndicator.getBoundingClientRect();
    const handleHeightStr = getComputedStyle(scrollIndicator).getPropertyValue('--handle-height');
    const handleHeight = parseFloat(handleHeightStr) / 100 * rect.height;
    const handleTopStr = getComputedStyle(scrollIndicator).getPropertyValue('--handle-top');
    const handleTop = parseFloat(handleTopStr) / 100 * rect.height;
    
    mouseOffset = e.clientY - rect.top - handleTop;
    // Clamp offset to be within the handle height
    mouseOffset = Math.max(0, Math.min(handleHeight, mouseOffset));
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const scrollIndicator = document.getElementById('scroll-indicator');
    if (!scrollIndicator) return;
    
    const rect = scrollIndicator.getBoundingClientRect();
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    
    // Get handle height from CSS variable
    const handleHeightStr = getComputedStyle(scrollIndicator).getPropertyValue('--handle-height');
    const handleHeight = parseFloat(handleHeightStr) / 100 * rect.height;
    
    // Calculate new scroll position considering the handle height and mouse offset
    const mouseY = e.clientY - rect.top - mouseOffset;
    const maxMouseY = rect.height - handleHeight;
    const normalizedMouseY = Math.max(0, Math.min(maxMouseY, mouseY));
    const scrollPosition = (normalizedMouseY / maxMouseY) * (scrollHeight - clientHeight);
    
    // Set scroll position without smooth behavior when dragging
    window.scrollTo({ top: scrollPosition, behavior: 'auto' });
    
    // Update handle position directly to avoid delay
    const maxHandleTop = 100 - (handleHeight / rect.height * 100);
    const handleTop = (normalizedMouseY / maxMouseY) * maxHandleTop;
    scrollIndicator.style.setProperty('--handle-top', `${handleTop}%`);
  });
  
  document.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.userSelect = '';
    mouseOffset = 0; // Reset offset
    // Remove dragging class
    const scrollIndicator = document.getElementById('scroll-indicator');
    if (scrollIndicator) {
      scrollIndicator.classList.remove('dragging');
    };
  });
};

// Export for global access
window.scrollIndicatorUtils = {
  updateScrollIndicator,
  initScrollIndicatorDrag
};
