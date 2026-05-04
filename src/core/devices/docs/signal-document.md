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

其中，`to` 是该信号最终要到达的节点（以路径形式，当然也不是“最终”，因为节点可能会将信号自行向下传输）

## 当前实现

当前代码中，信号的传输分为三层：

1. Device 采集现实输入，编码成一个信号包。
2. Device 内部通过 EventBus 发出“收到输入包”和“输出结果包”两个事件。
3. DevicesTree 按 `to` 路径继续把包分发到目标节点。

因此，EventBus 解决的是“设备内部和设备边界上的传输通知”，DevicesTree 解决的是“树上的空间路由”。

## 信号类型

`signals` 数组中的每个信号都由 `type + context` 组成。`type` 不做枚举封闭，允许自由扩展。

当前设计中常见信号包括：

- `position`：位置类信号，`context` 一般为 `Vector`，即 `{x: number, y: number}`。
- `pressure`：压力类信号，`context` 一般为 `number`。
- `tilt`：倾角类信号，`context` 一般为 `number`。
- `rotate`：旋转类信号，`context` 一般为 `number`。
- `end`：当前交互结束。
- `cancel`：当前交互取消。

但这些只是一组常见信号，而不是完整列表。工具和设备都应按“开放信号集”设计，而不是硬编码成固定几种事件。
