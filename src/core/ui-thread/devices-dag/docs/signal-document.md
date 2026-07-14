# CUI 信号文档

本文档提供 Hound Whiteboard 中 Core 输入信号的概述。

这里的“信号”特指在事件总线、DevicesDAG 和工具链之间传递的 `SignalPacket`。

## 最小结构

当前信号包的标准结构是：

```javascript
{
  to: String,
  signals: Array<{
    type: String,
    context: *
  }>
}
```

其中：

- `to`：当前包要继续路由到的节点路径
- `signals`：当前时刻要一起处理的信号列表

当前代码里，这个结构集中抽象为 [../signal.js](../signal.js) 中的 `SignalPacket` 类，对应源码路径：

```text
src/ui-thread/devices-dag/signal.js
```

## `SignalPacket` 的作用

`SignalPacket` 负责两件事：

- `SignalPacket.from(...)`：把任意输入规整为 `SignalPacket`
- `SignalPacket.normalizeResult(...)`：把 handler / tool 返回值规整成 `SignalPacket[]`

因此 Core 内部不再需要在各处重复实现 `normalizeSignalPacket()` 一类的私有转换逻辑。

## 当前实现中的三层角色

当前信号传递大致分为三层：

1. **宿主 / Device 层**：把原始输入编码成 `SignalPacket`
2. **事件入口层**：`Board.signalsEventBus.emit("input", packet)` 把包送入白板级 DAG
3. **DAG / Tool 层**：`DevicesDAG` 按 `to` 路径继续分发，最终由工具消费

因此：

- 事件总线解决“把输入送进 Core”
- `DevicesDAG` 解决“设备图上的空间路由”

## 信号类型

`signals` 数组中的每个信号都由 `type + context` 组成。`type` 不做枚举封闭，允许自由扩展。

当前常见信号包括：

- `position`：位置类信号，`context.value` 通常为 `{ x, y }`
- `pressure`：压力类信号，`context.value` 通常为 `number`
- `tilt`：倾角类信号，`context.value` 通常为 `number`
- `rotate`：旋转类信号，`context.value` 通常为 `number`
- `end`：当前交互结束
- `cancel`：当前交互取消

针对具体设备，还会出现更稳定的设备层信号，例如：

- keyboard：`trigger` / `trigger-repeat` / `release` / `cancel`
- touchscreen：`contacts` 一类的多触点摘要信号

## 多信号与多触点

同一个 `signals` 数组里允许出现多条同类型信号。

例如触摸屏设备可能在同一包中携带多条 `position` 信号；此时通常通过 `context.touchId`、`context.pointerId` 等字段区分不同触点。

这也是为什么信号设计采用“开放信号集 + context 扩展字段”的组合，而不是固定的闭合事件枚举。

## 当前设计约束

- `SignalPacket` 只描述“当前包的目标路径 + 信号列表”
- 它不表达节点状态
- 它不表达对象权威数据
- 它不直接等同于 DOM 事件

工具与设备都应按“开放信号集”设计，而不是硬编码成少数固定事件。

## 相关文档

- [devices-dag-document.md](./devices-dag-document.md)
- [handler-context-document.md](./handler-context-document.md)
- [core-input-encoding.md](../../../docs/core-input-encoding.md)
