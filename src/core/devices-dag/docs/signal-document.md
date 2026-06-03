# CUI 信号文档

本文档提供 Hound Whiteboard 中 CUI 信号的概述——特指 Core-UI 间通过信道传输的虚拟信号。

在事件总线中，信号以以下格式传输。

```javascript
{
  to: String
  signals: Array<{
    type: String
    context: *
  }>
}
```

其中，`to` 是该信号当前要到达的节点路径。

当前代码里，这个结构已经集中抽象为 [src/core/devices-dag/signal.js](../signal.js) 中的 `SignalPacket` 类。Core 内部不再在各处各自实现 `normalizeSignalPacket()`，而是统一通过 `SignalPacket.from()` 和 `SignalPacket.normalizeResult()` 完成规整。

## 当前实现

当前代码中，信号的传输分为三层：

1. Device 采集现实输入，编码成一个信号包。
2. Core-UI 边界在需要跨边界通知时，通过信道或 EventBus 传输 `SignalPacket`。
3. DevicesDAG 按 `to` 路径继续把包分发到目标节点。

因此，信道/EventBus 解决的是“跨边界传输通知”，DevicesDAG 解决的是“设备图上的空间路由”。

## 信号类型

`signals` 数组中的每个信号都由 `type + context` 组成。`type` 不做枚举封闭，允许自由扩展。

当前设计中常见信号包括：

- `position`：位置类信号，`context.value` 一般为 `Vector`，即 `{x: number, y: number}`。
- `pressure`：压力类信号，`context.value` 一般为 `number`。
- `tilt`：倾角类信号，`context.value` 一般为 `number`。
- `rotate`：旋转类信号，`context.value` 一般为 `number`。
- `end`：当前交互结束。
- `cancel`：当前交互取消。

这些信号在同一个 `signals` 数组里允许重复出现。比如触摸屏设备就可能在同一包中同时携带多条 `position` 信号；此时通常通过 `context.touchId`、`context.pointerId` 等字段区分不同触点。

当前代码里的触摸屏设备示例会把这类多条位置/结束信号聚合成一个 `touch-contacts` 信号，作为当前多指状态的摘要输出。

但这些只是一组常见信号，而不是完整列表。工具和设备都应按“开放信号集”设计，而不是硬编码成固定几种事件。
