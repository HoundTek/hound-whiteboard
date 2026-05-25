# 对象创建工具文档

## 概述

对象创建工具负责在白板上生成新对象，并在创建过程中管理对象几何的增量变化。

它不是一次性生成对象后结束，而是一个包含“手势生命周期”的连续流程。

## 处理流程

1. `process(signalPacket, deviceContext)` 接收一个完整信号包
2. `buildInteractionContext(signalPacket, deviceContext)` 解析：
   - 当前 `position`
   - 是否存在 `gesture end/cancel`
   - 是否存在 `object end/cancel`
   - `objectId` 和 `ownerChunkId`
3. `ensureObject(interaction)` 确保当前交互已有对象实例：
   - 如果尚无对象，则分配 id / ownerChunkId
   - 调用 `create(position, objectId, ownerChunkId)`
   - 将对象引用写回 `deviceContext.object`
   - 将对象写回 `deviceContext.nodeContext.object` 以支持同一路径后续 modifier
   - 将对象加入 `activeObjectManager`
4. 根据手势状态进入不同阶段：
   - `beginCreationGesture(interaction)`
   - `updateCreationGesture(interaction)`
   - `completeCreationGesture(interaction)`
   - `cancelCreationGesture(interaction)`
5. 最终调用 `completeCreatedObject(interaction)` 或 `cancelCreatedObject(interaction)`

## 创建完成策略

当前创建工具支持两种完成策略：

- `apply`：创建完成后直接调用 `AOM.apply(...)`，对象立即回到静态图
- `handoff`：创建完成后保持对象留在 AOM 中，并在当前 creator 节点下自动挂载固定 modifier 子工具

`handoff` 模式的流程是：

1. creator 完成创建但不调用 `AOM.apply(...)`
2. creator 将对象保留在 `deviceContext` / `nodeContext`
3. creator 在自身下方挂载对应的 modifier 子工具
4. creator 后续只负责持续提供对象上下文并将信号转发给 modifier
5. modifier 收到 `apply` 信号后再统一提交回静态图

## 几何刷新设计

对象创建工具在创建过程中也需要处理几何刷新：

- `beforeGeometryMutation(interaction)`：在几何变更前记录旧快照
- `afterGeometryMutation(interaction)`：在几何变更后请求活动层刷新

与 `ObjectModifierTool` 的不同点在于：

- 创建过程包含对象实例创建、id/ownerChunkId 分配、活动对象管理、手势生命周期
- 因此不能简单地把整个处理过程包装成一次 `withGeometryMutation(...)`
- 所以创建工具在不同阶段分别调用 `beforeGeometryMutation` / `afterGeometryMutation`

## 同一路径上下文共享

当前实现允许同一路径内的 creator 与 modifier 共享上下文：

- creator 工具创建对象后，写入 `deviceContext.object`
- 若存在 `deviceContext.nodeContext`，creator 还可以写入 `nodeContext.object`
- 同一路径挂载的后续 modifier 工具可从 `deviceContext.object` 或 `nodeContext.object` 读取该对象
- `handoff` 模式下，creator 自身会成为 modifier 的父节点，并持续负责这份上下文提供

这种共享仅在当前 signal dispatch 链路中有效，不应当作为跨事件持久状态使用。

## 当前状态

- `SingleGestureObjectCreatorTool` 适用于一个手势完成整个对象创建的场景
- `MultiGestureObjectCreatorTool` 适用于一个对象由多个手势逐步完成的场景
- 两者都复用对象创建工具基类的几何刷新钩子
- 创建工具可把新对象引用写入 `deviceContext.object` 和 `nodeContext.object`
- 创建工具现在可配置 `completionMode` 与 `createModifierTool`
- `deviceContext` 的写入仅用于同一次信号链路内的短期共享
- handoff workflow 被 `umount` 时，creator 会撤销未提交对象并清理上下文
