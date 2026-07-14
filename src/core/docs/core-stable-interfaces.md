# 阶段性稳定接口

## 概述

这一页记录当前 Core 中已经收敛、适合被业务代码直接依赖的最小接口面。

这里的“稳定”指的是：

- 当前代码树中已有明确实现
- 仓库内已有多处调用或测试依赖其语义
- 新功能应优先复用这些接口，而不是再引入旧兼容层

同时要注意：

- `undo` / `redo` 仍是预留入口，不属于“已实现能力”
- `/workflows/` 是 Board / Viewport 层的推荐约定，不是 `DevicesDAG` 的硬性限制

## Board 与事件入口

当前业务最常直接依赖的 `Board` 接口包括：

- `enableWorkerMode(worker, options?)`
- `createViewport(rootElement, { width, height }, viewportId)`
- `allocateObjectId()`
- `getBoardApi()`

`Board.signalsEventBus` 当前稳定的输入相关事件包括：

### `input`

```js
board.signalsEventBus.emit("input", {
  to: "/viewport-id/device-path",
  signals: [...],
});
```

语义：

- `to` 必须已包含目标 `viewportId`
- `Board` 会把它分发到唯一的 `Board.devicesDAG`
- 初始 dispatch context 会附带 `{ board, boardApi }`

## BoardApiRpc

当前可以稳定依赖的 `BoardApiRpc` 方法包括：

### 生命周期

- `createBoard(options)`
- `destroyBoard()`
- `createViewport(options)`
- `destroyViewport(viewportId)`

### 对象写入

- `createObject(type, props)`
- `modifyObject(objectId, patch)`
- `modifyObjects(patches)`
- `appendListItem(objectId, key, items)`
- `replaceListItem(objectId, key, index, item)`
- `removeListItem(objectId, key, index)`
- `commitObjects(objectIds)`
- `deleteObjects(objectIds)`
- `addActiveObjects(objectIds)`
- `discardActiveObjects(objectIds)`

### 查询

- `queryObjects(ids)`
- `queryChunkObjects(chunkIds)`
- `hitTest(range, mode?)`
- `requestDebug(query, extra?)`

### 需要特别说明的语义

- `modifyObject` / `appendListItem` / `replaceListItem` / `removeListItem` 当前会被微任务级合并为 `rpc-batch`
- `createObject` 当前要求显式传入 `props.id`
- `undo()` / `redo()` 方法名已存在，但 Worker 侧仍会抛出 `Not implemented yet.`

## DevicesDAG

当前建议依赖的 `DevicesDAG` 方法有：

- `getNode(path)`
- `getNodePath(node)`
- `ensureNode(path)`
- `addEdge(fromPath, edgeName, toPath)`
- `removeEdge(fromPath, edgeName)`
- `getNodeState(pathOrId)`
- `setNodeState(pathOrId, state)`
- `configureNode(path, options)`
- `mount(path, handler?, options?)`
- `mountWorkflow(path, workflow)`
- `mountSubDAG(basePath, subDAGDefinition)`
- `dispatch(packet)`
- `unmountWorkflow(path, context?)`
- `unmount(path, context?)`

### 稳定语义

- `configureNode()` **可以** 更新 `handler`、`semantics`、`defaultRoute`、`umount`
- `mountWorkflow(path, workflow)` 接受 **任意路径**；是否使用 `/workflows/` 由上层约定决定
- `workflow` 可以是单个 Tool，也可以是 `SubDAGDefinition`
- `mountSubDAG(basePath, subDAGDefinition)` 使用 `basePath + rootPath` 共同决定最终挂载路径
- 节点身份由 **node id** 决定，不是由路径字符串决定
- 同一节点允许多入边，多条路径可达同一个节点

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
- `state`
- `getState()`
- `setState(nextState)`
- `patchState(partial)`
- `getNodeState(pathOrId?)`
- `setNodeState(pathOrId, state)`
- `delNodeState(pathOrId?, ...keys)`
- `routeToChild(to, signals?)`
- `stop()`
- `signal(type, value, extra?)`

### 稳定语义

- `acc` 是逐层追加的累积上下文视图
- 可变共享数据优先写入节点 `state`
- `ctx.state` 是入口快照；写入后若要读取最新值，应调用 `getState()`
- `routeToChild()` 是向下转发信号的统一方式
- `signal()` 统一构造 `{ type, context }` 结构

## DevicesDAGHandlerResult

当前 handler 返回值已经收敛为以下字段：

```js
{
  packets?: SignalPacket[],
  acc?: Object,
  redirect?: string,
  stop?: boolean,
}
```

### 稳定语义

- `packets`：后续要继续路由的包列表
- `acc`：要追加给下游节点的累积上下文
- `redirect`：覆盖接下来要走的路径段
- `stop`：立即终止当前链路
- 若显式返回 `packets: []`，当前链路终止
- 若未显式返回 `packets`，则保持默认继续逻辑

## SubDAGDefinition

当前稳定结构如下：

```js
{
  rootPath: "/sub-dag-root",
  rootNodeId: 0,
  nodes: new Map([
    [0, { handler, semantics, defaultRoute, tool, umount }],
  ]),
  edges: [
    { name: "child", fromNodeId: 0, toNodeId: 1 },
  ],
  resetState,
  getState,
}
```

推荐通过 `createSubDAG(rootPath).build()` 生成，而不是手写旧对象树协议。

## Tool

当前建议依赖的 `Tool` 基类接口有：

- `createProcessor()`
- `syncUiOverlay(context?)`
- `createUiOverlayBinding()`
- `process(signalPacket, context)`
- `umount(context?)`
- `reset()`
- `resolveNodeState(context?, statePath?)`
- `writeNodeState(context?, nextState, statePath?)`
- `resolveContextObjects(context?)`
- `setContextObjects(context?, objects)`
- `clearContextObjects(context?)`
- `collectUiOverlayEntries(overlayContext?)`
- `requestUiOverlayRefresh(context?)`
- `on(hookName, listener)` / `off(hookName, listener)`

### 稳定语义

- Tool 是 **叶子消费型处理器**，不承担上层路由结构
- `createProcessor()` 会把 Tool 包装成可挂到 DAG 节点上的 handler
- overlay provider 的注册/注销由 `createUiOverlayBinding()` 负责
- 工具共享对象优先走节点 `state` 与 `acc.objects`
- 需要显式转发信号时，应由 prefix 或外层 DAG handler 负责；不要把 Tool 当成新的路由层

## Viewport

当前建议依赖的 Viewport 接口包括：

### 设备图挂载

- `mountSubDAG(path, subDAGDefinition)`
- `mountWorkflow(name, workflow, edges)`
- `unmountWorkflow(name, edges)`
- `addEdge(fromPath, edgeName, toPath)`
- 通过 `viewport.devicesDAG` 读取白板级唯一 DAG

### 视口控制

- `setViewportPosition(position)`
- `setViewportScale(scale, screenAnchor?)`
- `setViewportScaleAroundCenter(scale)`
- `setViewportState({ origin?, zoom? })`
- `flushViewportRender()`
- `resizeRenderLayers(width, height, options?)`
- `requestViewportUiRender()`

### 坐标与区块换算

- `screenPointToWorld(screenPoint, origin?, zoom?)`
- `screenToWorld(screenPos)`
- `worldToChunk(worldPos)`
- `screenToChunk(screenPos)`
- `getViewportWorldRect(origin?, zoom?)`
- `worldRectToScreenRect(rect, padding?)`

### UI overlay

- `registerUiOverlayProvider(provider, options?)`
- `unregisterUiOverlayProvider(provider, options?)`

### 稳定语义

- Viewport 不拥有独立 `DevicesDAG`
- 所有挂载最终都代理到 `Board.devicesDAG`
- `mountSubDAG()` 当前稳定签名是 `(path, subDAGDefinition)`，不是无参重载

## 当前不应写成已稳定的部分

以下能力当前不要在业务文档里写成“已可依赖实现”：

- `undo` / `redo` 的实际行为
- 完整文件模式默认已接通
- `/workflows/` 是 `DevicesDAG` 的硬约束
- 旧术语 `processor` / `defaultPath` / `configure` 事件等仍应被继续扩展

## 相关文档

- [handler 上下文（ctx）用法](../ui-thread/devices-dag/docs/handler-context-document.md)
- [设备图](../ui-thread/devices-dag/docs/devices-dag-document.md)
- [设备定义](../ui-thread/devices-dag/devices/docs/device-document.md)
- [对象创建工具](../ui-thread/devices-dag/tools/creator/docs/object-creator-document.md)
- [对象选择工具](../ui-thread/devices-dag/tools/chooser/docs/object-chooser-document.md)
- [对象修改工具](../ui-thread/devices-dag/tools/modifier/docs/object-modifier-document.md)
- [Core 输入流](./core-input-flow.md)
