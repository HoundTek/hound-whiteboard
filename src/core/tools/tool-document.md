# 工具基类

## 概述

Tool 是设备树末端的消费型处理器。

它的职责很明确：

- 接收已经稳定化的设备信号
- 读取运行时上下文和节点状态
- 修改白板对象、视口或交互状态
- 在需要时把输入继续送往当前节点的默认子链路

当前 Tool 已经和新 DevicesTree 上下文模型对齐，不再依赖旧 routeContext 或隐式 nodeContext 共享。

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

## 默认链路继续

continueToDefaultPath(signalPacket, deviceContext) 会在满足以下条件时返回一个新的相对转发包：

- 当前节点声明了 defaultChild
- 已经解析出 resolvedDefaultChildPath
- 对应子节点真实存在

如果条件不满足，则返回 undefined。

这使工具可以在“自己处理一部分信号”之后，把同一包继续交给下游默认工具节点。

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

## 设计约束

- Tool 只消费稳定设备信号，不承担宿主事件规整
- Tool 不拥有自己的树结构，路径归属始终来自 DevicesTree
- 共享对象必须显式写入节点 state
- 工具节点路径应显式写到最终叶子，避免隐式挂载

## 当前状态

chooser、creator、modifier 相关基类已经全部切到新 deviceContext 和节点 state 模型。

这意味着：

- modifier handoff 通过显式 child path state 传递对象
- 默认链路继续统一走 continueToDefaultPath()
- Board 输入链路测试已经覆盖 creator 到 modifier 的交接流程

## 相关文档

- [设备树](../devices/docs/devices-tree-document.md)
- [Core 输入流](../docs/core-input-flow.md)
- [阶段性稳定接口](../docs/core-stable-interfaces.md)
