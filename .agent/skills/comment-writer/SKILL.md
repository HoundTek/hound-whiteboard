---
name: comment-writer
description: Write and unify JSDoc, inline comments, and file headers following the project's established style. Use when adding or editing code comments.
---

# Comment Writer

按项目既有风格为代码补写、改写、统一 JSDoc 和行内注释。

## 参考基线

写作前先读取目标附近最邻近的现有注释：

1. 目标文件本身的现有 JSDoc 和注释
2. 同目录或相邻模块下的现有注释
3. 同一层级中最接近目标职责的说明文本

归纳稳定写法后再落笔。

## 文件头格式

所有源码文件头部统一为：

```javascript
/**
 * @file ...
 * @description ...
 * @module core/...
 * @author ...
 */
```

- `@file` — 简短的文件名或职责描述
- `@description` — 一句话说明文件职责，必须打句号
- `@module` — 路径格式为 `core/{path/to/module}`，与源码路径对应
- `@author` — 作者名。不确定时执行 `git config user.name`

作者名可执行 `git config user.name`、`git config --global user.name` 获取。

示例：

```javascript
/**
 * @file 白板组件
 * @description Board 类是白板在面向对象设计中的抽象核心，负责维护白板级区块实例所有权、对象实例注册表、区块加载引用计数、活动对象管理器以及 monitor/设备事件入口。
 * @module core/components/board
 * @author ...
 */
```

## JSDoc 规范

所有新增或修改的下列实体都要写 JSDoc：

- 函数（含顶层函数和方法）
- 类
- 字段和属性
- 常量

### 通用规则

- JSDoc 正文使用中文，类型名、术语按代码原名保留
- `@description` 必须打句号
- `@description` 如果一行能写完，就跟在标签后面；如果一行写不完，标签单独一行，正文从下一行开始
- `@description` 之外的标签（`@param`、`@returns`、`@throws`、`@type`、`@todo` 等），一句话时不打句号，多句话时要打句号
- 无标签的第一行描述（函数/类职责，紧接 `/**` 之后），**一律不打句号**。需多句描述时，改用 `@description` 标签承载详细内容。
- 优先延续相邻代码既有写法

### 字段和属性

```
@type {类型} 属性名 - 这是什么（必要时再说明为什么存在）
```

示例：

```javascript
/** @type {boolean} 当前修改手势是否激活 */
isModifyingGestureActive = false;

/** @type {{ x: number, y: number }|null} 手势锚点（世界坐标） */
_anchorPosition = null;
```

### 方法

方法注释优先写：

1. 职责 — 这个方法做什么
2. 参数语义 — 每个 `@param` 的含义
3. 返回值语义 — `@returns` 的含义
4. 异常条件 — `@throws` 的条件

不要重复实现细节。

示例：

```javascript
/**
 * 将当前修改对象提交回静态图
 * @param {Object} modificationContext - 修改上下文
 * @param {Iterable<*>|*} [objects] - 显式传入的对象或对象集合
 * @returns {boolean} 是否成功提交
 */
applyModifiedObjects(modificationContext, objects) { ... }
```

### 类和构造函数

```javascript
/**
 * 通用对象修改工具类
 * @class
 * @extends GestureBasedObjectModifierTool
 * @description 手势驱动的对象位置修改工具，适用于所有对象类型。
 */
class CommonObjectModifierTool extends GestureBasedObjectModifierTool {
  /**
   * @param {{
   *   onViewportChange?: Function,
   *   onFlush?: Function,
   * }} [options={}] - 配置选项
   */
  constructor(options = {}) { ... }
```

### 常量和枚举

```javascript
/**
 * 对象创建工具相关信号类型常量
 * @readonly
 * @enum {string}
 */
const OBJECT_CREATOR_SIGNAL_TYPES = Object.freeze({
  POSITION: "position",
  GESTURE_END: "end",
  ...
});
```

### 事件

事件通过 `Tool.on(name, callback)` / `Tool._emit(name, ...)` 机制发布。事件 JSDoc 格式：

```javascript
/**
 * 对象创建生命周期完成通知。
 * handoff 通过 {@link Tool#on|on('afterCreate', ...)} 订阅。
 * @param {Object} interaction - 当前交互上下文
 * @param {BasicObject} completedObject - 已完成的对象
 * @protected
 */
afterCompleteCreatedObject(interaction, completedObject) {
  this._emit("afterCreate", interaction, completedObject);
}
```

### 访问控制标签

- `@private` — 以下划线 `_` 开头的方法或属性
- `@protected` — 子类可访问的方法
- 大多数公开方法不需要显式标记 `@public`

### 状态标记

- `@abstract` — 抽象方法或类
- `@deprecated` — 已废弃的 API，需说明替代方案
- `@todo` — 待完善事项

## 行内注释

- 一句话时不打句号
- 多句话时要打句号
- 只注释读代码时不明显的意图、约束、阶段性策略或数据转换原因
- 不要把代码逐行翻译成自然语言

## 工作方式

1. 先找最近的现有样本，归纳目标文件当前风格
2. 只在目标范围内补注释，不顺手重写无关内容
3. 如果现有代码和注释存在偏差，以当前实现为准
4. 如果信息不足以写出准确注释，保留最小化、可验证的描述，不要编造行为
5. 优先产出可直接提交的结果，而不是泛泛建议

## 禁止事项

- 不要发明工作区里不存在的抽象、流程或状态机
- 不要把注释写成教程式长文
- 不要引入和周边文件明显不一致的注释风格
- 不要为了"完整"而补写未经代码证实的设计意图
- 不要使用装饰性分隔线注释块。禁止任何形式的纯装饰分隔线，包括但不限于：
  - 连续字符围栏：`// ----` / `// =====` / `// ****`
  - 行首行尾装饰：`// -- xxx ----` / `// == xxx ===` / `// ** xxx **`
  - 其他任何仅为视觉分割而无信息量的注释行
