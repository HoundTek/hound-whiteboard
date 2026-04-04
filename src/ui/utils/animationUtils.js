// Animation utilities for page transitions

const AnimationUtils = {
  // Track current page state
  currentPage: null,
  currentDepth: 0,
  
  // Page hierarchy
  pageHierarchy: {
    0: { name: 'start', depth: 0 },
    1: { name: 'settings', depth: 0 },
    2: { name: 'help', depth: 0 },
    3: { name: 'mine', depth: 0 },
    'appearance': { name: 'appearance', depth: 1, parent: 1 },
    'language': { name: 'language', depth: 1, parent: 1 }
  },
  
  // Determine animation type
  getAnimationType(fromPage, toPage) {
    const fromInfo = this.pageHierarchy[fromPage];
    const toInfo = this.pageHierarchy[toPage];
    
    if (!fromInfo || !toInfo) {
      return 'none';
    }
    
    // If different top-level pages (depth 0), use horizontal slide
    if (fromInfo.depth === 0 && toInfo.depth === 0) {
      return fromPage < toPage ? 'slide-left' : 'slide-right';
    }
    
    // If same parent section, use push/pull based on depth
    if (fromInfo.depth === 0 && toInfo.depth === 1) {
      // Going deeper: push in (scale up)
      return 'push-in';
    }
    
    if (fromInfo.depth === 1 && toInfo.depth === 0) {
      // Going up: pull out (scale down)
      return 'pull-out';
    }
    
    // If switching between subpages of same parent
    if (fromInfo.depth === 1 && toInfo.depth === 1 && fromInfo.parent === toInfo.parent) {
      return fromPage < toPage ? 'slide-left' : 'slide-right';
    }
    
    // If switching between subpages of different parents
    if (fromInfo.depth === 1 && toInfo.depth === 1 && fromInfo.parent !== toInfo.parent) {
      return fromInfo.parent < toInfo.parent ? 'slide-left' : 'slide-right';
    }
    
    return 'none';
  },
  
  // Apply animation to content
  applyAnimation(contentElement, animationType) {
    if (!contentElement) return;
    
    // Remove all animation classes first
    contentElement.classList.remove(
      'anim-slide-left',
      'anim-slide-right',
      'anim-push-in',
      'anim-pull-out'
    );
    
    // Force reflow to restart animation
    void contentElement.offsetWidth;
    
    // Add animation class
    if (animationType !== 'none') {
      contentElement.classList.add(`anim-${animationType}`);
    }
  },
  
  // Update current page state
  updateCurrentPage(pageId) {
    this.currentPage = pageId;
    const info = this.pageHierarchy[pageId];
    this.currentDepth = info ? info.depth : 0;
  }
};

// Export for global access
window.animationUtils = AnimationUtils;
