# Core 输入编码标准

本文档约束 Hound Whiteboard 当前阶段在进入 Core 之前，宿主输入应如何被规整成 Core 可消费的 `SignalPacket`。

## 目标

这一层只解决一件事：

- 把外部输入规整成统一的包结构
- 再送进 `board.signalsEventBus.emit("input", packet)`

它不负责：

- 推断工具语义
- 决定设备图内部路由
- 直接修改 `BoardCore` 状态

这些职责分别属于：

- 宿主归属判断
- Device / DevicesDAG
- Tool / `BoardApiRpc` / `Viewport`

## 最小输出格式

所有输入都应先规整成：

```javascript
{
  to: "/viewport-id/device-path",
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

- `to` 必须已经包含目标 `viewportId`
- `signals` 必须是数组
- 每个信号至少包含 `type`
- 信号载荷统一放在 `context`

## Viewport 归属

宿主侧输入绑定逻辑必须在进入 Core 前决定目标 viewport。

也就是说，编码层需要先知道：

- 当前事件属于哪个 viewport
- 当前 viewport 下应该走哪个设备路径

`Board` 当前只负责根据 `to` 中的 `viewportId` 找到目标 `Viewport`，再把包送进白板级唯一 `DevicesDAG`。它不会替宿主补全目标路径。

## 鼠标 / 单点输入约定

对于鼠标、单笔、单触点这类单点输入，当前推荐约定如下：

- `position`
  - `context.value`: `{ x, y }` 或 `Vector` 兼容坐标
- `pressure`
  - `context.value`: `number`
- `tilt`
  - `context.value`: `number`
- `rotate`
  - `context.value`: `number`
- `end`
  - 表示本次交互结束
- `cancel`
  - 表示本次交互取消

鼠标输入当前还常携带这些上下文字段：

- `context.button`
- `context.buttons`
- `context.domEvent`
- `context.ctrlKey / shiftKey / altKey / metaKey`

这些字段主要供**设备层**使用，用来决定当前输入应进入 `primary`、`secondary`、`pointer` 还是其它设备分支。Tool 层不应再把它们当作主要判定条件。

### 坐标参考系

进入鼠标设备根节点的 `position` 信号 `context.value` 应为 **canvas 相对坐标**：

```
canvasX = clientX - canvas.getBoundingClientRect().left
canvasY = clientY - canvas.getBoundingClientRect().top
```

宿主层在编码鼠标信号时应完成 canvas 偏移扣除。世界坐标转换由鼠标设备根节点自动完成，不在编码层处理。

## 键盘输入约定

进入键盘设备根节点的宿主输入，当前建议仍按 DOM 键盘事件规整：

- `keydown`
  - `context.code`
  - `context.key`
  - `context.repeat`
  - `context.ctrlKey / shiftKey / altKey / metaKey`
- `keyup`
  - 字段同 `keydown`
- `cancel`
  - 表示当前键盘交互被宿主强制中断，如失焦

最小示例：

```javascript
{
  to: "/viewport/keyboard",
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

进入键盘设备后，设备子图会把这些原始输入进一步规整为更稳定的工具层信号，例如：

- `trigger`
- `trigger-repeat`
- `release`
- `cancel`

然后再通过 code 节点与边级 prefix 把它们送入 workflow。

## 哪些键盘输入应进入设备图

当前建议只有两类键盘输入编码为键盘设备信号：

1. 直接操作某个 viewport，如平移、缩放、刷新视口
2. 最终会被某个 workflow / tool 消费，如 `W/A/S/D`、`Space`、`Enter`、`Escape`

是否“最终会被工具消费”，应在宿主绑定层就已经明确；Core 不负责替你判断某个按键原本是不是应用级快捷键。

## 哪些键盘输入不应进入设备图

以下输入通常不应先绕进 Core 设备图：

- `Command+S` / `Ctrl+S` 这类宿主级保存快捷键
- 切换面板、菜单命令、窗口命令等应用级热键
- 与 viewport 操作和 tool 消费无关的全局热键

这些输入可以直接在宿主 UI 层处理。

## 多点输入约定

对于触摸屏这类多点输入，同一个 `signals` 数组里允许出现多条同类型信号。

例如：

```javascript
{
  to: "/viewport/touchscreen",
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

推荐字段：

- `touchId`
- `pointerId`
- `value`

重点只有一个：同一包里的多个触点必须能被稳定区分。

## 宿主事件到信号的映射建议

当前推荐映射方向如下：

- `mousedown` / `mousemove` -> `position`
- `mouseup` -> `position + end`
- `mouseleave` -> `cancel`
- `pointermove` / `touchmove` -> `position`
- `pointerdown` / `touchstart` -> 首个 `position`，必要时附加 `pressure`
- `pointerup` / `touchend` -> `end`
- `pointercancel` / `touchcancel` -> `cancel`
- `keydown` -> `keydown`
- `keyup` -> `keyup`

是否把一次宿主事件编码成一个信号还是多个信号，应按“同一时刻需要被一起处理的信息”决定。

例如：

- 一个 `mouseup` 可以编码成同包内的 `position + end`
- 一个 PointerEvent 可以同时编码出 `position + pressure`
- 一次 TouchEvent 可以编码成多条 `position` / `end` / `cancel`

## 当前不冻结的部分

下面这些目前仍保留实现自由度：

- `context` 里除 `value` / `touchId` / `pointerId` 外的扩展字段
- 宿主事件与设备路径之间的具体映射表
- 是否附加调试字段

但无论如何变化，都不应破坏上面的最小输出格式。

## 相关文档

- [Core 输入流](./core-input-flow.md)
- [SignalPacket](../ui-thread/devices-dag/docs/signal-document.md)
- [设备定义](../ui-thread/devices-dag/devices/docs/device-document.md)
- [鼠标设备](../ui-thread/devices-dag/devices/docs/mouse-device-document.md)
- [canvas-to-world-handler](../ui-thread/devices-dag/prefixes/docs/canvas-to-world-handler-document.md)
