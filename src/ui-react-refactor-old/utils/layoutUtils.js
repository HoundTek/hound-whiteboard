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
    
    // 获取容器宽度
    const containerWidth = container.offsetWidth;
    if (containerWidth === 0) return;
    
    // 使用按钮最小宽度（155px）加上间距（20px）
    const buttonWidth = 155 + 20; // 最小宽度120px + 间距20px
    
    // 根据容器宽度计算最大可能的列数
    const maxPossibleColumns = Math.floor(containerWidth / buttonWidth);
    
    // 找到小于等于maxPossibleColumns的最大因子
    let optimalColumns = 1;
    for (let i = Math.min(maxPossibleColumns, buttonCount); i >= 1; i--) {
      if (buttonCount % i === 0) {
        optimalColumns = i;
        break;
      }
    }
    
    // 确保至少有1列
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
