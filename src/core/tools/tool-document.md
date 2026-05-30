# 工具基类

## 概述

Tool 是设备树末端的消费型处理器，**只做叶子节点**。

### 职责边界

| 层面                         | 做什么                          | 谁做                    |
| ---------------------------- | ------------------------------- | ----------------------- |
| 信号预处理（锚点/转换/路由） | 位置锚定、位移转换、状态机切换  | 修饰节点（prefix node） |
| 对象编排（who→who）          | creator→modifier 桥接、对象传递 | `createHandoffSubTree`  |
| 信号消费（叶子）             | 创建对象、修改对象、选择对象    | **Tool**                |

### Tool 只做三件事

1. **接收信号** — `process(signalPacket, deviceContext)`
2. **消费信号** — 修改白板对象或状态
3. **返回 undefined** — 不转发、不挂载子节点、不感知上下游

所有 orchestration（路由、桥接、状态切换）已上移到**修饰节点层**，由
`createHandoffSubTree` + `multi-tool-prefix` + `TOOL_COMPLETE` 等握手协议统一管理。

### 实例归属规则

**一个 Tool 实例只属于一个设备树节点。** 不应将同一实例挂载到多个节点或在多个 subtree 间共享。

这保证了：
- `wrapCreatorForHandoff` 替换 `completeCreatedObject` 等 hook 操作安全（不会污染其他使用方）
- 工具实例状态（`isCreatingGestureActive`、`_isGestureActive` 等）不会跨节点串扰
- umount 时清理行为明确（一个节点卸载，对应一个实例释放）

违反本条的场景：如将同一个 `new StrokeCreatorTool()` 同时传给两个 `createHandoffSubTree()` 调用。

## 上下文模型

Tool.createProcessor(toolContext) 会生成一个可直接挂到 DevicesTree 节点上的 handler。

这个 handler 在运行时会把 DevicesTreeHandlerContext 规整成 deviceContext，核心字段包括：

- eventContext：当前节点的只读事件上下文
- runtimeContext：board、monitor、allocateObjectId 等运行时资源
- tree：所属 DevicesTree
- node：当前节点
- path：当前节点绝对路径
- defaultChild：当前节点声明的默认子链路
- resolvedDefaultChildPath：默认子链路对应的绝对路径
- getNodeState：读取节点 state
- setNodeState：写入节点 state

为兼容工具侧常用调用，deviceContext 还会把以下字段提升到顶层：

- board
- monitor
- allocateObjectId
- resolveOwnerChunkId

如果某个工具覆写了 `collectUiOverlayEntries(...)`，那么 `createProcessor(...)` 还会自动帮它完成一件事：

- 首次处理输入时，把这个工具对应的 overlay provider 注册到当前 monitor
- 工具节点卸载时，自动注销对应 provider

这样 `UiRenderer` 就不需要自己反向扫描设备树来猜“现在谁该画什么”，而是由工具在自己的生命周期内主动声明 overlay。

## 对象上下文辅助方法

Tool 现在提供一组围绕节点 state 的对象上下文工具：

- resolveContextObjects(deviceContext)
- setContextObjects(deviceContext, objects)
- clearContextObjects(deviceContext)
- resolveNodeState(deviceContext, statePath)
- writeNodeState(deviceContext, nextState, statePath)

这些方法的设计意图是：

- 优先复用当前节点 state
- 避免 creator、chooser、modifier 依赖同一个可变上下文对象
- 让父节点到子节点的共享变成显式路径状态同步

对于兼容 ui overlay，这些辅助方法还有一个额外用途：

- chooser / modifier 可以直接复用节点 state 中的对象集合来声明自己的选择框 provider
- 这份 state 只是工具自己的上下文来源，不再是 `UiRenderer` 直接扫描的入口

## 默认链路继续

continueToDefaultPath(signalPacket, deviceContext) 会在满足以下条件时返回一个新的相对转发包：

- 当前节点声明了 defaultChild
- 已经解析出 resolvedDefaultChildPath
- 对应子节点真实存在

如果条件不满足，则返回 undefined。

这使工具可以在“自己处理一部分信号”之后，把同一包继续交给下游默认工具节点。

## 与 prefix 的边界

Tool 与 prefix 可以在同一条链路上协作，但边界不同：

- prefix 可以决定信号去哪个 child
- prefix 可以把一个输入包拆成多个下游包
- Tool 不负责维护子节点路由表
- Tool 不负责决定自己之上的状态机切换规则

当前随机圆 demo 已经采用这条分层：

- 前置 prefix 负责生成随机 `position`、`radius` 和颜色属性
- 参数 prefix 负责把随机参数改写为圆工具可消费的信号序列
- CircleCreatorTool 只负责消费这些稳定信号并创建对象

这里还要明确一条边界：

- `button`、`buttons`、`activeKeys` 这类仅在设备语境中有意义的字段，不应成为工具节点自己的决策条件
- 例如 mouse 已经根据 `button` 把输入路由到 `/primary`、`/secondary` 等分支后，工具只应消费自己收到的 `position/end/cancel` 等稳定信号
- 若某个工具仍要依赖这些设备字段，说明设备语义还没有在上游收口干净

## 挂载方式

当前推荐把工具挂在显式叶子路径上，例如：

```js
monitor.mountTool("/mouse/pointer/tool", pointerTool);
```

或直接对 DevicesTree 调用：

```js
tree.mountTool("/monitor/main/mouse/pointer/tool", pointerTool, {
  board,
  monitor,
});
```

mountTool() 内部会使用 tool.createProcessor() 作为 handler，并在卸载时调用 tool.umount()。

## 子类约定

自定义工具通常只需要实现：

- static parse()
- serialize()
- process(signalPacket, deviceContext)
- reset()

如果工具需要卸载清理，可覆盖 umount(deviceContext)，或依赖基类在 umount 时自动回调 reset()。

如果工具需要在 `uiCanvas` 上声明兼容 overlay，可额外覆写：

- `collectUiOverlayEntries({ deviceContext, monitor, renderer, activeObjectManager })`

该方法返回的条目会通过 monitor 上注册的 provider 交给 `UiRenderer`。

## 设计约束

- Tool 只消费稳定设备信号，不承担宿主事件规整
- Tool 不读取仅在设备路由阶段有意义的字段，例如 mouse 的 `button/buttons`
- Tool 不拥有自己的树结构，路径归属始终来自 DevicesTree
- 共享对象必须显式写入节点 state
- 工具节点路径应显式写到最终叶子，避免隐式挂载

## 当前状态

chooser、creator、modifier 相关基类已经全部切到新 deviceContext 和节点 state 模型。

这意味着：

- modifier handoff 通过显式 child path state 传递对象
- 默认链路继续统一走 continueToDefaultPath()
- Board 输入链路测试已经覆盖 creator 到 modifier 的交接流程

同时要明确当前状态：

- 新增 workflow 更推荐使用 prefix 处理参数注入、多子工具路由和状态机
- 现有 creator / chooser 内部的 handoff 逻辑仍然保留，是当前基线上的兼容实现

## 相关文档

- [设备树](../devices/docs/devices-tree-document.md)
- [Core 输入流](../docs/core-input-flow.md)
- [阶段性稳定接口](../docs/core-stable-interfaces.md)
