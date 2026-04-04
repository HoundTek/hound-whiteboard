/**
 * @file 滚动指示器工具
 * @module utils/scrollIndicator
 * @description 功能：
 * - 自定义滚动指示器，隐藏原生滚动条
 */

/**
 * 滚动指示器拖动状态
 * @type {boolean}
 */
let isDragging = false;

/**
 * 更新滚动指示器位置和大小
 */
const updateScrollIndicator = () => {
  if (isDragging) return;
  
  const scrollIndicator = document.getElementById('scroll-indicator');
  if (!scrollIndicator) return;
  
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;
  const scrollTop = document.documentElement.scrollTop;
  
  const isScrollable = scrollHeight > clientHeight + 1;
  
  if (isScrollable) {
    const handleHeightRatio = Math.min(0.5, Math.max(0.1, clientHeight / scrollHeight));
    const handleHeight = handleHeightRatio * 100;
    
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
 * 初始化滚动指示器拖动功能
 */
const initScrollIndicatorDrag = () => {
  const scrollIndicator = document.getElementById('scroll-indicator');
  if (!scrollIndicator) return;
  
  let mouseOffset = 0;
  
  scrollIndicator.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.userSelect = 'none';
    scrollIndicator.classList.add('dragging');
    
    const rect = scrollIndicator.getBoundingClientRect();
    const handleHeightStr = getComputedStyle(scrollIndicator).getPropertyValue('--handle-height');
    const handleHeight = parseFloat(handleHeightStr) / 100 * rect.height;
    const handleTopStr = getComputedStyle(scrollIndicator).getPropertyValue('--handle-top');
    const handleTop = parseFloat(handleTopStr) / 100 * rect.height;
    
    mouseOffset = e.clientY - rect.top - handleTop;
    mouseOffset = Math.max(0, Math.min(handleHeight, mouseOffset));
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const scrollIndicator = document.getElementById('scroll-indicator');
    if (!scrollIndicator) return;
    
    const rect = scrollIndicator.getBoundingClientRect();
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    
    const handleHeightStr = getComputedStyle(scrollIndicator).getPropertyValue('--handle-height');
    const handleHeight = parseFloat(handleHeightStr) / 100 * rect.height;
    
    const mouseY = e.clientY - rect.top - mouseOffset;
    const maxMouseY = rect.height - handleHeight;
    const normalizedMouseY = Math.max(0, Math.min(maxMouseY, mouseY));
    const scrollPosition = (normalizedMouseY / maxMouseY) * (scrollHeight - clientHeight);
    
    window.scrollTo({ top: scrollPosition, behavior: 'auto' });
    
    const maxHandleTop = 100 - (handleHeight / rect.height * 100);
    const handleTop = (normalizedMouseY / maxMouseY) * maxHandleTop;
    scrollIndicator.style.setProperty('--handle-top', `${handleTop}%`);
  });
  
  document.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.userSelect = '';
    mouseOffset = 0;
    const scrollIndicator = document.getElementById('scroll-indicator');
    if (scrollIndicator) {
      scrollIndicator.classList.remove('dragging');
    }
  });
};

/**
 * 滚动指示器工具对象
 * @type {Object}
 */
window.scrollIndicatorUtils = {
  updateScrollIndicator,
  initScrollIndicatorDrag
};
