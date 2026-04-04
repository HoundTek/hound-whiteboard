/**
 * @file 动画工具
 * @module utils/animationUtils
 * @description 功能：
 * - 页面过渡动画管理
 */

/**
 * 动画工具对象
 * @typedef {Object} AnimationUtils
 * @property {Object} pageHierarchy 页面层级关系
 * @property {function} getAnimationType 获取动画类型
 * @property {function} applyAnimation 应用动画
 * @property {function} updateCurrentPage 更新当前页面状态
 */

/**
 * 动画工具对象
 * @type {AnimationUtils}
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
  
  /**
   * 获取动画类型
   * @param {string|number} fromPage 源页面ID
   * @param {string|number} toPage 目标页面ID
   * @returns {string} 动画类型（slide-left、slide-right、push-in、pull-out、none）
   */
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
  
  /**
   * 应用动画到内容元素
   * @param {HTMLElement} contentElement 内容元素
   * @param {string} animationType 动画类型
   */
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
  
  /**
   * 更新当前页面状态
   * @param {string|number} pageId 页面ID
   */
  updateCurrentPage(pageId) {
    this.currentPage = pageId;
    const info = this.pageHierarchy[pageId];
    this.currentDepth = info ? info.depth : 0;
  }
};

/**
 * 动画工具对象
 * @type {AnimationUtils}
 */
window.animationUtils = AnimationUtils;
