/**
 * @file 布局工具函数
 * @module layoutUtils
 * @description 功能：
 * - 计算按钮容器的最佳列数，实现响应式按钮布局
 */

/**
 * 计算按钮容器的最佳列数
 */
const calculateOptimalColumns = () => {
  const buttonContainers = document.querySelectorAll('.button-container');
  buttonContainers.forEach(container => {
    const buttonCount = container.querySelectorAll('.icon-button').length;
    if (buttonCount === 0) return;
    
    const containerWidth = container.offsetWidth;
    if (containerWidth === 0) return;
    
    const buttonWidth = 155 + 20;
    
    const maxPossibleColumns = Math.floor(containerWidth / buttonWidth);
    
    let optimalColumns = 1;
    for (let i = Math.min(maxPossibleColumns, buttonCount); i >= 1; i--) {
      if (buttonCount % i === 0) {
        optimalColumns = i;
        break;
      }
    }
    
    container.style.setProperty('--columns', Math.max(1, optimalColumns));
  });
};

/**
 * 布局工具对象
 * @type {Object}
 */
window.layoutUtils = {
  calculateOptimalColumns
};
