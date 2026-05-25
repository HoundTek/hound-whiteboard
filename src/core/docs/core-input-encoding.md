# Core 输入编码标准

本文档约束 HoundWhiteboard 当前阶段在进入 Core 之前，外部输入应如何被规整成 Core 可消费的 `SignalPacket`。

## 目标

这层标准只解决一件事：把外部输入规整成统一的包结构，再送进 `board.signalsEventBus.emit("input", packet)`。

它不负责：

- 推断工具语义
- 决定设备树内部路由
- 直接修改 `Board` 状态

这些职责分别属于 Device、DevicesTree 和 Tool。

## 最小输出格式

所有输入都应先规整成：

```javascript
{
  to: "/monitor-id/device-path",
  signals: [
    {
      type: "position",
      context: {
        value: { x: 10, y: 20 },
      },
    },
  ],
}
```

约束如下：

- `to` 必须已经包含目标 `monitorId`
- `signals` 必须是数组
- 每个信号至少包含 `type`
- 信号载荷统一放在 `context`

## 单点输入约定

对于鼠标、单笔、单触点这类单点输入，推荐约定如下：

- `position`
  - `context.value`: `{ x, y }` 或 `Vector` 等坐标值
- `pressure`
  - `context.value`: `number`
- `tilt`
  - `context.value`: `number`
- `rotate`
  - `context.value`: `number`
- `end`
  - `context`: 结束当前交互所需的附加信息
- `cancel`
  - `context`: 取消当前交互所需的附加信息

当前鼠标实现还额外约定了几项常用字段：

- `context.button`: 当前事件对应的按钮
- `context.buttons`: 当前按钮位掩码
- `context.domEvent`: 原始 DOM 事件名
- `context.ctrlKey / shiftKey / altKey / metaKey`: 当前修饰键状态

这些字段目前主要用于鼠标设备在设备层判断“当前是在悬停还是在主键拖动”。

## 键盘输入约定

对于会进入键盘设备子树的输入，当前建议直接按 DOM 键盘事件规整：

- `keydown`
  - `context.code`: 键位编码，如 `KeyW`、`Space`
  - `context.key`: 字符或键名，如 `w`、` `、`ArrowUp`
  - `context.repeat`: 是否为长按重复触发
  - `context.ctrlKey / shiftKey / altKey / metaKey`: 当前修饰键状态
- `keyup`
  - 字段同 `keydown`
- `cancel`
  - 表示当前键盘交互被宿主强制中断，如 Monitor 失焦

一个最小示例如下：

```javascript
{
  to: "/monitor/keyboard",
  signals: [
    {
      type: "keydown",
      context: {
        code: "Space",
        key: " ",
        repeat: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      },
    },
  ],
}
```

这里的重点不是“所有键盘事件都进 Core”，而是“只有已经确定属于某个 Monitor 设备语义的键盘输入，才进入 Core”。

进入键盘设备后，设备树节点还可以继续把原始 `keydown` / `keyup` 改写成更稳定的设备语义信号。这个能力现在不是键盘设备私有逻辑，而是 `DevicesTreeNode` 的通用配置：节点可声明 `rewritePacket`。例如某个按键节点可以把 `trigger` 改写为一条 `position`，再在返回包里显式写入 `/keyboard/tools/...` 这类公共工具节点路径。

## 哪些键盘输入应进入设备树

当前建议只有两类键盘输入编码为键盘设备信号：

- 该输入直接操作某个 Monitor，如缩放、平移视角、翻区块浏览
- 该输入最终会被某个工具消费，如用户绑定的 `WASD`、按住空格绘制、按键触发临时工具

是否“最终会被工具消费”，应在宿主绑定层就已经明确；Core 不负责替你判断一个按键原本是不是快捷键。

## 哪些键盘输入不应进入设备树

下面这些输入不应编码为键盘设备信号：

- `Command+S` / `Ctrl+S` 这类宿主级保存快捷键
- 切换工具、打开 UndoTree、打开面板这类应用级命令快捷键
- 与 Monitor 操作和工具消费无关的全局热键

这些输入可以直接在宿主 UI 层处理，不需要先绕到 Core 的设备树里再转回来。

## 多点输入约定

对于触摸屏这类多点输入，同一个 `signals` 数组里允许出现多条同类型信号。

例如：

```javascript
{
  to: "/monitor/touchscreen",
  signals: [
    {
      type: "position",
      context: {
        touchId: "finger-1",
        value: { x: 10, y: 20 },
      },
    },
    {
      type: "position",
      context: {
        touchId: "finger-2",
        value: { x: 30, y: 40 },
      },
    },
  ],
}
```

推荐字段如下：

- `touchId`: 触点 id
- `pointerId`: 若来自 PointerEvent，可直接沿用
- `value`: 当前坐标

约束重点只有一个：同一包里的多个触点必须能被稳定区分。

## 宿主输入到信号的映射建议

当前建议的映射方向如下：

- `mousedown` -> `position`
- `mousemove` -> `position`
- `mouseup` -> `position + end`
- `mouseleave` -> `cancel`
- `pointermove` / `touchmove` -> `position`
- `pointerdown` / `touchstart` -> 首个 `position`，必要时附加 `pressure`
- `pointerup` / `touchend` -> `end`
- `pointercancel` / `touchcancel` -> `cancel`

是否要把一次 DOM 事件编码成一个信号，还是多个信号，应按“同一时刻应被一起处理的信息”来决定。

例如：

- 一个 MouseEvent 可以编码成一条 `position`，并通过 `buttons` 表示当前是否仍按着主键
- 一个 `mouseup` 可以编码成同一包内的 `position + end`
- 一个 PointerEvent 同时有位置与压力，就可以编码成同一个包内的两条信号
- 一次 TouchEvent 含多个 changedTouches，就可以编码成同一个包内的多条 `position` / `end` / `cancel`
- 一次键盘事件通常只需要编码成一条 `keydown`、`keyup` 或 `cancel`

这里的“映射建议”只描述进入 Core 前的包形状，不要求这层逻辑一定实现为 Core 内部模块。当前 `whiteboard.js` 中的鼠标 demo 就是直接在模板层临时绑定 DOM 事件后再发射 `SignalPacket`。

## Monitor 归属

宿主侧输入绑定逻辑必须在进入 Core 前决定目标 Monitor。

也就是说，编码层需要先知道：

- 当前事件属于哪个 Monitor
- 当前 Monitor 下应该走哪个设备路径

因为 `Board` 当前只负责按 `to` 中的 `monitorId` 把包分发到对应 Monitor，而不会替你补全目标路径。

## 当前不冻结的部分

下面这些目前仍保留实现自由度：

- `context` 里除 `value` / `touchId` / `pointerId` 外的扩展字段
- 宿主事件与设备路径之间的具体映射表
- 是否在进入 Core 前先做坐标转换
- 是否在宿主侧附加调试字段

但无论如何变化，都不应破坏上面的最小输出格式。
