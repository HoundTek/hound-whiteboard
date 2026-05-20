# 工具文档

本文档提供白板中工具的概述。

## 工具的定义

工具是挂载在设备树末端的消费型处理器。不同的工具会消费到达当前节点的信号包，并直接修改白板、对象或相关状态。比如你可以将选择工具、笔工具（每个笔刷都是一个工具）等绑定到笔、鼠标等设备子树的末端节点上。

## 工具的信号接口

工具系统现在以信号包为统一输入格式：

```javascript
{
	to: String,
	signals: Array<{
		type: String,
		context: *,
	}>
}
```

每个工具都实现统一的 `process(signalPacket, deviceContext)` 入口。它一次接收一个完整信号包，而不是逐个吃信号。若工具要挂到设备树上，则通常作为某个设备通道节点下面的独立 `/tool` 节点存在，并由上层通过 `mount` 事件在运行时追加；节点处理器仍由 `createProcessor()` 生成，该处理器内部会通过 `SignalPacket.from()` 先把输入规整为统一类实例。

`signals` 中的信号类型可以彼此不同。比如同一个包内可以同时出现：

```javascript
[
  { type: "position", context: { x: 1, y: 2 } },
  { type: "pressure", context: 0.7 },
  { type: "tilt", context: 32 },
  { type: "end", context: {} },
];
```

这里的 `type` 只是信号名，不预设固定枚举；`context` 则承载该信号所需的数据。除了 `position + Vector`、`tilt + number`、`rotate + number`、`pressure + number` 这类常见组合外，还可以有 `end`、`cancel` 以及任何后续扩展信号。

这意味着：

- Tool 不再直接假设输入来源是鼠标、触摸或笔。
- Tool 不再依赖固定的 `start / move / end` 生命周期兼容层。
- Tool 不应依赖具体硬件键位或按钮编号；这类原始输入应先由设备节点改写成语义化信号。
- Tool 的职责是读取整包信号，结合上下文，直接执行白板修改、对象修改或状态更新。
- Tool 默认不负责把信号继续向下传输；设备树内部的转发由设备节点处理器承担。

## 工具节点最小接口

当前代码里，一个工具若要挂到设备树节点上，最小接口只有两层：

1. 工具对象实现 `process(signalPacket, deviceContext)`
2. 通过 `createProcessor(toolContext)` 把它包装成设备树节点处理器

工具的挂载入口通过事件总线实现：

1. `board.signalsEventBus.emit("mount", { to, tool })`
2. `board.signalsEventBus.emit("umount", { to })`

也就是说，设备树真正挂在工具节点上的不是“工具类”本身，而是 `createProcessor()` 返回的节点处理器。

当前 `deviceContext` 可稳定假设的字段主要有：

- `path`：当前工具节点的绝对路径
- `node`：当前设备树节点
- `tree`：所属 `DevicesTree`
- `depth`：当前分发深度

如果业务侧在 `createProcessor(toolContext)` 中额外注入了上下文，则还可稳定获得：

- `board`：当前白板
- `monitor`：当前 Monitor
- 其它业务层主动注入的固定上下文

当前默认注入、并已被 creator 链路实际使用的上下文能力还有：

- `allocateObjectId()`：默认转发到 `Board.allocateObjectId()`，用于申请新的对象 id
- `resolveOwnerPageId(position)`：默认通过 `Monitor.worldToPage()` 从世界坐标解析对象归属页

这意味着当前工具链中，`position` 的输入语义已经固定为“世界坐标 / 全局坐标”，而不是页内坐标或屏幕坐标。

对应的坐标规整不再发生在 `createProcessor()` 里。发往 `Board.signalsEventBus` 的位置类信号，应当在进入 Core 之前就已经完成“屏幕坐标 -> 世界坐标”的换算。

对象若自身维护局部几何数据，则应在工具内部把世界坐标转换成相对 `obj.position` 的局部坐标再写入对象。当前 `StrokeCreatorTool` 与 `PolygonCreatorTool` 都遵循这一约束。

推荐约束如下：

- Tool 默认只消费信号，不承担设备树继续路由的职责
- Tool 的 `process()` 可以返回 `void`
- 若某个处理单元需要继续改写 `to` 并向下转发，它更适合作为设备节点处理器，而不是 Tool

## 工具的类别

### 对象创建工具

对象创建工具是用来创建对象的工具，对于每种对象，都有一个对应的对象创建工具。

比如笔刷工具就是一种对象创建工具。笔刷工具也有很多种，比如铅笔、钢笔等。

### 对象选择工具

对象选择工具是用来选择对象的工具，适用于所有对象。

对象选择工具有多种形状。比如套索工具可以框选任意曲线内的对象（在底层，曲线其实是一个有非常多条边的多边形）；矩形选择工具可以框选一个框形内的对象。特别地，所有的对象选择工具都应支持将点选识别为单选。

### 对象擦除工具

对象擦除工具是用来擦除对象的工具，适用于可擦对象。

对象擦除工具也有多种形状。它于套索工具的差别主要是它会直接修改对象，并且是将对象的一部分直接擦掉。

### 白板工具

白板工具是用于改变白板状态的工具，适用于白板而不是对象。

白板工具可以给白板加页、删页、更改页面位置等。白板工具较为特殊，因为它是直接跟白板（而不是对象）打交道的。它通常依赖 Monitor / Board 提供的上下文来执行变更。

## 工具的职责分层

- Device 负责定义设备子树，并把现实输入编码为信号包。
- 设备树节点负责按路径和状态路由信号；设备通道节点通常通过 `defaultPath` 把信号继续送到独立的工具节点。
- Tool 负责消费信号，并调用 Board / Object / ActiveObjectManager 等核心模块完成修改。
- Monitor 负责提供视口语义与坐标映射辅助；若需要从屏幕坐标换算到世界坐标，应在信号进入 Core 之前完成。
- Board / Object 等 Core 组件负责保存最终状态，Tool 不再承担信号转发职责。

## 工具的持久化

Hound Whiteboard 内置了很多的基础工具，但是这远不能满足用户自定义的需求。对于工具而言，用户自定义的方法有两种——插件或工具包。工具包就是用工具配置的持久化实现的，它是基于 Hound Whiteboard 内置的基础工具实现的。
