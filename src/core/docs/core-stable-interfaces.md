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
- unmountTool(path, routeContext)
- mountDevice(basePath, deviceDefinition, runtimeContext)
- unmount(path, routeContext)
- unmountLeaf(path, routeContext)
- dispatch(signalPacket, routeContext)

稳定语义：

- 节点处理统一使用 handler
- defaultChild 是相对子链路名
- 工具挂载使用显式叶子路径
- 结构化设备定义使用 root + nodes

## DeviceDefinition

当前稳定结构如下：

```js
{
  root: "/device-root",
  nodes: {
    handler,
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

推荐通过 createDevice(root).build() 生成，不直接依赖旧的对象协议。

## Tool

当前建议依赖的 Tool 接口有：

- createProcessor(toolContext)
- createRuntimeContext(routeRuntimeContext, toolContext)
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

## Monitor

当前建议依赖的 Monitor 输入接口有：

- mountDevice(deviceDefinition)
- mountDevice(pathPrefix, deviceDefinition)
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

## 不再推荐继续使用的旧术语

以下旧接口名应视为已完成迁移，不应继续在新代码中引入：

- processor
- rewritePacket
- defaultPath
- defineNodes
- nodeContext
- providedObjectsContext

## 相关文档

- [设备树](../devices/docs/devices-tree-document.md)
- [设备定义](../devices/docs/device-document.md)
- [工具基类](../tools/tool-document.md)
- [Core 输入流](./core-input-flow.md)
