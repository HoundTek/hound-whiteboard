# 阶段性稳定接口

## 概述

这一页记录当前输入系统已经收敛、可被业务代码依赖的最小接口面。

这里的“稳定”指的是：

- 当前重构已经完成迁移
- 已有聚焦测试覆盖核心语义
- 新增功能应优先复用这些接口，而不是继续引入兼容层

## DevicesTree

当前建议依赖的公开方法有：

- getNode(path)
- getNodeState(path)
- setNodeState(path, state)
- mount(path, handler, options)
- configureNode(path, options)
- mountTool(path, tool, toolContext)
- unmountTool(path, accumulatedContext)
- mountSubTree(basePath, subTreeDefinition, mountContext)
- unmount(path, accumulatedContext)
- unmountLeaf(path, accumulatedContext)
- dispatch(signalPacket, accumulatedContext)

稳定语义：

- 节点处理统一使用 handler
- defaultChild 是相对子链路名
- 工具挂载使用显式叶子路径
- 结构化设备定义使用 root + nodes
- handler 返回统一规整为 `{ packets, context, redirect, stop }`
- `packets.to` 只描述从当前节点继续向下的子路径

## DevicesTreeHandlerContext

当前稳定字段包括：

- node
- tree
- path
- semantics
- defaultChild
- resolvedDefaultChildPath
- depth
- signalPacket
- context
- getNodeState(path?)
- setNodeState(path, state)

稳定语义：

- `context` 是逐层追加的累积上下文，不能覆盖已有键
- 需要可变共享数据时，应写入节点 state
- 需要向上通知时，优先在 `context` 中注入回调函数，而不是继续引入向上路由协议

## SubTreeDefinition

当前稳定结构如下：

```js
{
  root: "/sub-tree-root",
  nodes: {
    handler,
    semantics,
    defaultChild,
    tool,
    toolContext,
    umount,
    children,
  },
  resetState,
  getState,
}
```

推荐通过 createSubTree(root).build() 生成，不直接依赖旧的对象协议。

## Tool

当前建议依赖的 Tool 接口有：

- createProcessor(toolContext)
- createDeviceContext(handlerContext, toolContext)
- process(signalPacket, deviceContext)
- umount(deviceContext)
- reset()
- resolveNodeState(deviceContext, statePath)
- writeNodeState(deviceContext, nextState, statePath)
- resolveContextObjects(deviceContext)
- setContextObjects(deviceContext, objects)
- clearContextObjects(deviceContext)
- continueToDefaultPath(signalPacket, deviceContext)

稳定语义：

- `deviceContext` 顶层字段 `path`、`context`、`board`、`monitor`、`getNodeState`、`setNodeState` 已稳定
- `deviceContext` 不再构造 `eventContext` / `runtimeContext` 兼容视图
- 工具代码应直接读取顶层字段与 `context`

## Monitor

当前建议依赖的 Monitor 输入接口有：

- mountSubTree(subTreeDefinition)
- mountSubTree(pathPrefix, subTreeDefinition)
- mountTool(path, tool)
- unmountTool(path)
- 通过 board.devicesTree 读取当前输入树

稳定语义：

- Monitor 不拥有独立 DevicesTree
- 所有挂载最终都代理到 Board.devicesTree

## 配置事件

Board.signalsEventBus 侧当前稳定的输入相关事件包括：

- input：分发输入包到 Board.devicesTree.dispatch()
- mount：挂载设备或工具节点
- umount：卸载设备或工具节点
- configure：运行时更新节点 handler、defaultChild、umount

这些事件的 `to` 仍然是绝对路径，但节点内部继续返回的 `packets.to` 应视为局部子路径。

## 不再推荐继续使用的旧术语

以下旧接口名应视为已完成迁移，不应继续在新代码中引入：

- processor
- rewritePacket
- defaultPath
- defineNodes
- nodeContext
- providedObjectsContext
- 子节点通过 `to: ".."` 或 `bubble` 向上协调的约定

## 相关文档

- [设备树](../devices/docs/devices-tree-document.md)
- [设备定义](../devices/docs/device-document.md)
- [工具基类](../tools/tool-document.md)
- [Core 输入流](./core-input-flow.md)
