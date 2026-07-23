/**
 * @file 信号类型注册表
 * @description 提供设备图框架级信号类型的单一事实源与 payload 契约说明。
 * @module core/ui-thread/devices-dag/dag-core/signal-types
 * @author Zhou Chenyu
 */

/**
 * 设备图框架级信号类型注册表
 * @readonly
 * @enum {string}
 * @description
 * 信道契约的单一事实源：设备/工具/wrapper 生产或消费框架级信号时，
 * 必须使用本注册表中的值，禁止在模块内另起本地枚举。
 * 应用/演示级自定义信号类型（如 demo 的 trigger、radius、debug:*）不进注册表，
 * 由应用层自行声明。
 * @author Zhou Chenyu
 */
const SIGNAL_TYPES = Object.freeze({
  /** 世界坐标绝对位置（context.value 或 context.position 携带 Vector 兼容值），驱动手势状态机 */
  POSITION: "position",
  /** 相对位移（context.value 携带向量），无状态增量，无准入检测 */
  DISPLACEMENT: "displacement",
  /** 手势结束 */
  END: "end",
  /** 手势取消 */
  CANCEL: "cancel",
  /** 多手势对象结束 */
  OBJECT_END: "object-end",
  /** 多手势对象取消 */
  OBJECT_CANCEL: "object-cancel",
  /** 显式提交动作 */
  SUCCESS: "success",
  /** 外部强制结束动作（如 tool-switcher 切换时终结当前工具动作） */
  END_ACTION: "end-action",
  /** prefix 注入的对象属性（context.value 携带属性对象） */
  PROPERTY: "property",
  /** 工具切换（button-group 设备 → tool-switcher，context.activeTool 携带目标工具名） */
  TOOL_SWITCH: "tool-switch",
  /** 按钮按下（DOM → button-group 设备，context.toolName 携带按钮对应工具名） */
  BUTTON_PRESS: "button-press",
  /** 触摸触点聚合（touchscreen 设备输出，context.contacts 携带触点列表） */
  TOUCH_CONTACTS: "touch-contacts",
  /** 键盘触发（keyboard 设备输出，keydown 非重复） */
  TRIGGER: "trigger",
  /** 键盘重复触发（keyboard 设备输出，keydown 按住重复） */
  TRIGGER_REPEAT: "trigger-repeat",
  /** 键盘释放（keyboard 设备输出，keyup 或等效结束） */
  RELEASE: "release",
});

export { SIGNAL_TYPES };
