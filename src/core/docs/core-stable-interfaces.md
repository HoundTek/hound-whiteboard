# 阶段性稳定接口

## 概述

这一页记录当前输入系统已经收敛、可被业务代码依赖的最小接口面。

模块运行边界见 [core-runtime-boundaries.md](./core-runtime-boundaries.md)。

这里的“稳定”指的是：

- 当前重构已经完成迁移
- 已有聚焦测试覆盖核心语义
- 新增功能应优先复用这些接口，而不是继续引入兼容层

## DevicesDAG

当前建议依赖的公开方法有：

- `getNode(path)`
- `getNodePath(node)`
- `getNodeState(pathOrId)`
- `setNodeState(pathOrId, state)`
- `mount(path, handler, options)`
- `configureNode(path, options)`：更新节点语义/元数据（**不用于设置 handler**）
- `mountWorkflow(path, workflow, workflowContext)`
- `unmountWorkflow(path, accumulatedContext)`
- `mountSubDAG(basePath, subDAGDefinition, mountContext)`
- `unmount(path, accumulatedContext)`
- `dispatch(signalPacket, accumulatedContext)`

稳定语义：

- 节点处理统一使用 `handler`
- `defaultRoute` 是当前节点的默认出边名
- **workflow 统一挂载到 `/<viewportId>/workflows/` 下**，通过 `addEdge` 与设备节点连接
- `mountWorkflow` 的第一个参数是 workflow 在 `/workflows/` 下的路径，不再是设备子路径
- `workflow` 可以是单个 Tool，也可以是单源 `SubDAGDefinition`
- 结构化设备定义使用 `rootPath + nodes + edges`
- `handler` 返回统一规整为 `{ packets, context, redirect, stop }`
- `packets.to` 只描述从当前节点继续向下的子路径
- 节点身份由 node id 决定，而不是由路径决定

## DevicesDAGHandlerContext

当前稳定字段包括：

- `node`
- `dag`
- `path`
- `semantics`
- `defaultRoute`
- `resolvedDefaultRoutePath`
- `depth`
- `signalPacket`
- `acc`
- `state` — 当前节点状态的只读快照
- `getState()` — 重读节点最新状态
- `setState(nextState)` — 全量写入节点状态
- `patchState(partial)` — 浅合并写入节点状态
- `routeToChild(to, signals?)` — 路由信号到子节点
- `stop()` — 终止当前链路
- `signal(type, value, extra?)` — 构造标准信号 { type, context: { value?, ...extra } }，value 为 undefined 时省略
- `getNodeState(pathOrId?)` — 读取任意节点状态
- `setNodeState(pathOrId, state)` — 写入任意节点状态

稳定语义：

- `acc` 是逐层追加的累积上下文，handler 不能在此平级新增键
- 需要可变共享数据时，使用 `setState` / `patchState` 写入节点 `state`
- `initialState` 可通过 `createPrefixNodeHandler` 提供默认值，参与 `ctx.state` 的合并视图
- 需要向上通知时，优先在 `acc` 中注入回调函数，而不是继续引入向上路由协议
- 同一节点允许有多条路径可达，但单次 dispatch 的 `context` 只沿当前命中的那条路径累积

## SubDAGDefinition

当前稳定结构如下：

```js
{
  rootPath: "/sub-dag-root",
  rootNodeId: 0,
  nodes: new Map([
    [0, { handler, semantics, defaultRoute, tool, toolContext, umount }],
  ]),
  edges: [
    { name: "child", fromNodeId: 0, toNodeId: 1 },
  ],
  resetState,
  getState,
}
```

推荐通过 `createSubDAG(rootPath).build()` 生成，而不是手写旧对象协议。

## Tool

当前建议依赖的 Tool 接口有：

- `createProcessor(toolContext)`
- `createDeviceContext(handlerContext, toolContext)`
- `process(signalPacket, deviceContext)`
- `umount(deviceContext)`
- `reset()`
- `resolveNodeState(deviceContext, statePath)`
- `writeNodeState(deviceContext, nextState, statePath)`
- `resolveContextObjects(deviceContext)`
- `setContextObjects(deviceContext, objects)`
- `clearContextObjects(deviceContext)`
- `continueToDefaultPath(signalPacket, deviceContext)`

稳定语义：

- `deviceContext` 顶层字段 `path`、`context`、`board`、`viewport`、`getNodeState`、`setNodeState` 已稳定
- `deviceContext` 不再构造 `eventContext` / `runtimeContext` 兼容视图
- 工具代码应直接读取顶层字段与 `context`

## Viewport

当前建议依赖的 Viewport 输入接口有：

- `mountSubDAG(subDAGDefinition)`
- `mountSubDAG(pathPrefix, subDAGDefinition)`
- `mountWorkflow(path, workflow)`
- `unmountWorkflow(path)`
- 通过 `board.devicesDAG` 读取当前输入图

稳定语义：

- Viewport 不拥有独立 `DevicesDAG`
- 所有挂载最终都代理到 `Board.devicesDAG`

## 配置事件

`Board.signalsEventBus` 侧当前稳定的输入相关事件包括：

- `input`：分发输入包到 `Board.devicesDAG.dispatch()`
- `mount`：挂载设备或 workflow，支持 `edge.prefix` 注入信号转换
- `umount`：卸载设备或 workflow

这些事件的 `to` 仍然是绝对路径，但节点内部继续返回的 `packets.to` 应视为局部子路径。

## 不再推荐继续使用的旧术语

以下旧接口名应视为已完成迁移，不应继续在新代码中引入：

- `processor`
- `rewritePacket`
- `defaultPath`
- `defineNodes`
- `nodeContext`
- `providedObjectsContext`
- `configure`（事件）
- 子节点通过 `to: ".."` 或 `bubble` 向上协调的约定

## 相关文档

- [handler 上下文（ctx）用法](../ui/devices-dag/docs/handler-context-document.md)
- [设备图](../ui/devices-dag/docs/devices-dag-document.md)
- [设备定义](../ui/devices-dag/devices/docs/device-document.md)
- [对象创建工具](../ui/devices-dag/tools/creator/docs/object-creator-document.md)
- [对象选择工具](../ui/devices-dag/tools/chooser/docs/object-chooser-document.md)
- [对象修改工具](../ui/devices-dag/tools/modifier/docs/object-modifier-document.md)
- [Core 输入流](./core-input-flow.md)
