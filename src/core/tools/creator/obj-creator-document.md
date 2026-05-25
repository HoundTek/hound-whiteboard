# 对象创建工具文档

## 概述

对象创建工具负责在白板上生成新对象，并在创建过程中管理对象几何的增量变化。它不是一次性生成对象后结束，而是一个包含“手势生命周期”的连续流程。

## 流程

1. `process(signalPacket, deviceContext)` 接收一个完整信号包。
2. `buildInteractionContext(...)` 解析：
   - 当前位置 `position`
   - 是否存在 `gesture end/cancel`
   - 是否存在 `object end/cancel`
   - `objectId` 和 `ownerChunkId`
3. `ensureObject(interaction)` 确保当前交互已有对象实例：
   - 如果尚无对象，则分配 id/ownerChunkId
   - 调用 `create(position, objectId, ownerChunkId)`
   - 将对象加入 `activeObjectManager`
4. 根据手势状态进入不同阶段：
   - `beginCreationGesture(interaction)`
   - `updateCreationGesture(interaction)`
   - `completeCreationGesture(interaction)`
   - `cancelCreationGesture(interaction)`
5. 最终调用 `completeCreatedObject(interaction)` 或 `cancelCreatedObject(interaction)`。

## 几何刷新设计

对象创建工具在创建过程中也需处理几何刷新：

- `beforeGeometryMutation(interaction)`：在几何变更前记录旧快照
- `afterGeometryMutation(interaction)`：在几何变更后请求活动层刷新

与 `ObjectModifierTool` 的最大差别是：

- 创建工具包含对象实例创建、id/ownerChunkId 分配、活动对象管理、手势生命周期等多个阶段
- 这使得创建过程无法简单地用单次 `withGeometryMutation(...)` 封装
- 因此创建工具在不同阶段分别调用 `beforeGeometryMutation` / `afterGeometryMutation`

## 当前状态

- `SingleGestureObjectCreatorTool` 适用于一个手势完成整个对象创建的场景。
- `MultiGestureObjectCreatorTool` 适用于一个对象由多个手势逐步完成的场景。
- 两者都复用对象创建工具基类中的几何刷新钩子，但没有提供一次性包装器。
