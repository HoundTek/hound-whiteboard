/**
 * @file 鼠标菜单组件
 * @module components/MouseMenu
 * @description 功能：
 * - 显示在鼠标指针位置的弹出菜单
 */

/**
 * 鼠标菜单组件
 * @param {Object} props 组件属性
 * @param {boolean} props.isOpen 是否显示菜单
 * @param {number} props.x 鼠标X坐标
 * @param {number} props.y 鼠标Y坐标
 * @param {Array} props.items 菜单项数组
 * @param {string} props.items[].label 菜单项文本
 * @param {function} props.items[].onClick 点击回调
 * @param {function} props.onClose 关闭回调
 * @returns {React.ReactElement} 菜单元素
 */
function MouseMenu({ isOpen, x, y, items, onClose }) {
  if (!isOpen) return null;

  const calculatePosition = () => {
    const menuWidth = 180;
    const menuHeight = items.length * 36;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let posX = x;
    let posY = y;

    if (posX + menuWidth > windowWidth) {
      posX = Math.max(0, posX - menuWidth - 10);
    } else {
      posX += 10;
    }

    if (posY + menuHeight > windowHeight) {
      posY = Math.max(0, posY - menuHeight - 10);
    } else {
      posY += 10;
    }

    return {
      left: `${posX}px`,
      top: `${posY}px`
    };
  };

  const position = calculatePosition();

  return React.createElement('div', {
    className: 'mouse-menu',
    style: {
      left: position.left,
      top: position.top
    },
    onClick: (e) => {
      e.stopPropagation();
    }
  }, items.map((item, index) => React.createElement('button', {
    key: index,
    className: 'mouse-menu-item',
    onClick: () => {
      item.onClick();
      onClose();
    }
  }, item.label)));
}

/**
 * 鼠标菜单组件
 * @type {function}
 */
window.MouseMenu = MouseMenu;
