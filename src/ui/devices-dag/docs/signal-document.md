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

当前代码里，这个结构集中抽象为 [../dag-core/signal.js](../dag-core/signal.js) 中的 `SignalPacket` 类，对应源码路径：

```text
src/ui/devices-dag/dag-core/signal.js
```

## `SignalPacket` 的作用

`SignalPacket` 负责两件事：

- `SignalPacket.from(...)`：把任意输入规整为 `SignalPacket`
- `SignalPacket.normalizeResult(...)`：把 handler / tool 返回值规整成 `SignalPacket[]`

因此 Core 内部不再需要在各处重复实现 `normalizeSignalPacket()` 一类的私有转换逻辑。

## 不可变约定

信号包与信号对象在图内流动时按**只读**处理：

- `SignalPacket.from(...)` 对已是实例的输入原样返回，不复制
- 任何 handler / prefix / tool **不得原地修改**收到的信号或其 `context`（包括 `value`、`buttons` 等字段）
- 需要转换时必须新建对象（`{ ...signal, context: { ...signal.context, value: next } }`）
- 设备向多个下游分支扇出时，每个分支获得独立的 `signals` 数组浅拷贝（数组独立、元素仍共享，因此元素同样不可原地修改）

违反约定会让同帧的兄弟分支读到被篡改的信号，且故障点与修改点可能相距很远，极难排查。

## 当前实现中的三层角色

当前信号传递大致分为三层：

1. **宿主 / Device 层**：把原始输入编码成 `SignalPacket`
2. **事件入口层**：`Board.signalsEventBus.emit("input", packet)` 把包送入白板级 DAG
3. **DAG / Tool 层**：`DevicesDAG` 按 `to` 路径继续分发，最终由工具消费

因此：

- 事件总线解决“把输入送进 Core”
- `DevicesDAG` 解决“设备图上的空间路由”

## 信号类型

`signals` 数组中的每个信号都由 `type + context` 组成。`type` 分两层：

- **框架级信号**必须取 `SIGNAL_TYPES`（[signal-types.js](../dag-core/signal-types.js)）中的值，禁止在模块内另立本地枚举
- **应用/演示级类型**（如 demo 的 `trigger`、`radius`、`debug:*`）不进注册表，由应用层自行声明

框架级信号共 15 个：

| type | 含义 |
| --- | --- |
| `position` | 世界坐标绝对位置，`context.value` 携带 Vector 兼容值，驱动手势状态机 |
| `displacement` | 相对位移，无状态增量、无准入检测，可与 `position` 同帧叠加 |
| `end` | 手势结束 |
| `cancel` | 手势取消 |
| `object-end` / `object-cancel` | 多手势对象结束 / 取消 |
| `success` | 显式提交动作 |
| `delete` | 删除当前持有的活动对象 |
| `end-action` | 外部强制结束动作（如 tool-switcher 切换时终结当前工具动作） |
| `property` | prefix 注入的对象属性（`context.value` 携带属性对象） |
| `tool-switch` | 工具切换（`context.activeTool` 携带目标工具名） |
| `button-press` | 按钮按下（`context.toolName` 携带按钮对应工具名） |
| `touch-contacts` | 触摸触点聚合（`context.contacts` 携带触点列表） |
| `trigger` / `trigger-repeat` / `release` | 键盘按下 / 按住重复 / 释放 |

设备层只负责把宿主输入规整成上述类型，不引入新的框架级类型。

## 多信号与多触点

同一个 `signals` 数组里允许出现多条同类型信号。

例如触摸屏设备可能在同一包中携带多条 `position` 信号；此时通常通过 `context.touchId`、`context.pointerId` 等字段区分不同触点。

这也是为什么注册表只固定 `type` 取值、把可变部分交给 `context` 扩展字段。

## 当前设计约束

- `SignalPacket` 只描述“当前包的目标路径 + 信号列表”
- 它不表达节点状态
- 它不表达对象权威数据
- 它不直接等同于 DOM 事件

工具与设备只能消费 `SIGNAL_TYPES` 中的框架级类型；需要新语义时先在注册表增项，而不是在模块内硬编码字符串。

## 相关文档

- [devices-dag-document.md](./devices-dag-document.md)
- [handler-context-document.md](./handler-context-document.md)
- [core-input-encoding.md](../../../docs/core-input-encoding.md)
