/**
 * @file 动画工具
 * @module utils/animationUtils
 * @description 功能：
 * - 页面过渡动画管理
 */

const AnimationUtils = {
  currentPage: null,
  currentDepth: 0,
  
  pageHierarchy: {
    0: { name: 'start', depth: 0 },
    1: { name: 'settings', depth: 0 },
    2: { name: 'help', depth: 0 },
    3: { name: 'mine', depth: 0 },
    'appearance': { name: 'appearance', depth: 1, parent: 1 },
    'language': { name: 'language', depth: 1, parent: 1 }
  },
  
  getAnimationType(fromPage, toPage) {
    const fromInfo = this.pageHierarchy[fromPage];
    const toInfo = this.pageHierarchy[toPage];
    
    if (!fromInfo || !toInfo) {
      return 'none';
    }
    
    if (fromInfo.depth === 0 && toInfo.depth === 0) {
      return fromPage < toPage ? 'slide-left' : 'slide-right';
    }
    
    if (fromInfo.depth === 0 && toInfo.depth === 1) {
      return 'push-in';
    }
    
    if (fromInfo.depth === 1 && toInfo.depth === 0) {
      return 'pull-out';
    }
    
    if (fromInfo.depth === 1 && toInfo.depth === 1 && fromInfo.parent === toInfo.parent) {
      return fromPage < toPage ? 'slide-left' : 'slide-right';
    }
    
    if (fromInfo.depth === 1 && toInfo.depth === 1 && fromInfo.parent !== toInfo.parent) {
      return fromInfo.parent < toInfo.parent ? 'slide-left' : 'slide-right';
    }
    
    return 'none';
  },
  
  applyAnimation(contentElement, animationType) {
    if (!contentElement) return;
    
    contentElement.classList.remove(
      'anim-slide-left',
      'anim-slide-right',
      'anim-push-in',
      'anim-pull-out'
    );
    
    void contentElement.offsetWidth;
    
    if (animationType !== 'none') {
      contentElement.classList.add(`anim-${animationType}`);
    }
  },
  
  updateCurrentPage(pageId) {
    this.currentPage = pageId;
    const info = this.pageHierarchy[pageId];
    this.currentDepth = info ? info.depth : 0;
  }
};

window.animationUtils = AnimationUtils;
