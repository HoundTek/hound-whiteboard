/**
 * @file 设备相关常量
 * @description 定义设备相关的常量，如默认路由名称、标准键盘码等。
 * @module core/ui/devices-dag/devices/constant
 * @author Zhou Chenyu
 */

/**
 * 标准键盘码全集
 * @description
 * 涵盖所有常规键盘事件的 `code` 值，用于键盘设备预创建节点。
 * @type {ReadonlyArray<string>}
 */
const STANDARD_KEYBOARD_CODES = Object.freeze([
  // 字母
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  // 主键盘数字
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  // 功能键
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  // 方向键
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  // 导航
  "Home",
  "End",
  "PageUp",
  "PageDown",
  // 编辑
  "Insert",
  "Delete",
  "Backspace",
  // 空白
  "Space",
  "Tab",
  "Enter",
  // 修饰键
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  // 符号
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
  "Backquote",
  "IntlBackslash",
  // 小键盘
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
  "NumpadEnter",
  // 锁定键
  "CapsLock",
  "NumLock",
  "ScrollLock",
  // 其它
  "Escape",
  "Pause",
  "PrintScreen",
  "ContextMenu",
]);

/**
 * 设备默认路由名称
 * @description
 * 设备节点在 DAG 中的默认路由名称，设备信号将通过该路由向外分发。
 * 外部子 DAG 可基于该路由添加监听器或进行信号重写。
 * @type {string}
 */
const DEVICE_DEFAULT_ROUTE = "default";

export { STANDARD_KEYBOARD_CODES, DEVICE_DEFAULT_ROUTE };
