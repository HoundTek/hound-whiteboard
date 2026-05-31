# 工具基类

## 概述

Tool 是设备树末端的消费型处理器，只做叶子节点。

### 职责边界

| 层面       | 做什么                                 | 谁做                   |
| ---------- | -------------------------------------- | ---------------------- |
| 信号预处理 | 锚点、参数注入、局部路由、状态机       | 修饰节点               |
| 对象编排   | first → second 切换、对象桥接          | `createHandoffSubTree` |
| 末端消费   | 创建对象、修改对象、选择对象、更新视口 | Tool                   |

### Tool 只做三件事

1. 接收信号：`process(signalPacket, deviceContext)`
2. 消费信号：修改白板对象或状态
3. 默认不继续转发：它不是新的路由层

所有 orchestration 都已经上移到 prefix 层。新的稳定模型优先使用：

- 修饰节点路由
- 节点 `state`
- 累积 `context` 中的回调

仓库中仍有少量旧工具保留兼容型完成信号输出，但那不再是新的首选设计。

## 实例归属规则

一个 Tool 实例只属于一个设备树节点。

这保证了：

- hook `completeCreatedObject()` 这类包装操作不会污染其他链路
- 工具内部状态不会跨节点串扰
- `umount()` 时的清理边界明确

## 上下文模型

`Tool.createProcessor(toolContext)` 会生成一个可直接挂到 DevicesTree 节点上的 handler。这个 handler 会把 `DevicesTreeHandlerContext` 规整成 `deviceContext`。

当前推荐直接依赖的顶层字段有：

- `tree`
- `node`
- `path`
- `defaultChild`
- `resolvedDefaultChildPath`
- `depth`
- `context`
- `board`
- `monitor`
- `allocateObjectId`
- `resolveOwnerChunkId`
- `getNodeState`
- `setNodeState`

这里的 `context` 就是来自 DevicesTree 的累积上下文。它通常会携带：

- `board`
- `monitor`
- 工作流回调，例如 `onToolComplete`
- 其他由上游 prefix 注入的只读数据

`deviceContext` 现在不再构造 `eventContext` / `runtimeContext` 两层兼容视图。
工具应直接读取顶层字段与 `context`。

## 对象上下文辅助方法

Tool 现在提供一组围绕节点 `state` 的对象上下文工具：

- `resolveContextObjects(deviceContext)`
- `setContextObjects(deviceContext, objects)`
- `clearContextObjects(deviceContext)`
- `resolveNodeState(deviceContext, statePath)`
- `writeNodeState(deviceContext, nextState, statePath)`

这些方法的设计意图是：

- 优先复用当前节点 `state`
- 避免 creator、chooser、modifier 依赖同一个可变上下文对象
- 让父节点到子节点的共享变成显式路径状态同步

## 默认链路继续

`continueToDefaultPath(signalPacket, deviceContext)` 会在满足以下条件时返回一个新的相对转发包：

- 当前节点声明了 `defaultChild`
- 已经解析出 `resolvedDefaultChildPath`
- 对应子节点真实存在

如果条件不满足，则返回 `undefined`。

它适合那种“工具先消费一部分信号，再把同一包继续交给默认后继节点”的局部链路。

## 与 prefix 的边界

Tool 与 prefix 可以在同一条链路上协作，但边界不同：

- prefix 可以决定信号去哪个 child
- prefix 可以把一个输入包拆成多个下游包
- Tool 不负责维护子节点路由表
- Tool 不负责决定自己之上的状态机切换规则

当前随机圆 demo 已经采用这条分层：

- 前置 prefix 负责生成随机 `position`、`radius` 和颜色属性
- 参数 prefix 负责把随机参数改写为圆工具可消费的信号序列
- `CircleCreatorTool` 只负责消费这些稳定信号并创建对象

对应路径是：

- `/keyboard/code/Space/create-circle`
- `/keyboard/code/Space/create-circle/params`
- `/keyboard/code/Space/create-circle/params/tool`

## 挂载方式

当前推荐把工具挂在显式叶子路径上，例如：

```js
monitor.mountTool("/mouse/pointer/tool", pointerTool);
monitor.mountTool("/keyboard/code/KeyW/tool", moveTool);
```

或直接对 DevicesTree 调用：

```js
tree.mountTool("/monitor/main/mouse/pointer/tool", pointerTool, {
  board,
  monitor,
});
```

`mountTool()` 内部会使用 `tool.createProcessor()` 作为 handler，并在卸载时调用 `tool.umount()`。

## 子类约定

自定义工具通常只需要实现：

- `static parse()`
- `serialize()`
- `process(signalPacket, deviceContext)`
- `reset()`

如果工具需要卸载清理，可覆盖 `umount(deviceContext)`，或依赖基类在 `umount` 时自动回调 `reset()`。

如果工具需要在 `uiCanvas` 上声明兼容 overlay，可额外覆写：

- `collectUiOverlayEntries({ deviceContext, monitor, renderer, activeObjectManager })`

该方法返回的条目会通过 monitor 上注册的 provider 交给 `UiRenderer`。

## 设计约束

- Tool 只消费稳定设备信号，不承担宿主事件规整
- Tool 不应再把 `button`、`buttons` 这类设备路由字段当作自己的主决策条件
- Tool 不拥有自己的树结构，路径归属始终来自 DevicesTree
- 共享对象必须显式写入节点 `state`
- 工具节点路径应显式写到最终叶子，避免隐式挂载

## 当前状态

creator、chooser、modifier 相关基类已经切到新的 `deviceContext` 与节点 `state` 模型。

这意味着：

- modifier handoff 优先通过回调与状态桥接完成
- 默认链路继续统一走 `continueToDefaultPath()`
- Board 输入链路测试已经覆盖 creator 到 modifier 的交接流程
- Tool 上下文已经完全收敛为新版平面 `deviceContext`

## 相关文档

- [设备树](../devices/docs/devices-tree-document.md)
- [Core 输入流](../docs/core-input-flow.md)
- [阶段性稳定接口](../docs/core-stable-interfaces.md)
