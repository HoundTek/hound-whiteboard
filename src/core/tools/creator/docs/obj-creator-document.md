# 对象创建工具文档

## 概述

对象创建工具负责在白板上生成新对象，并在创建过程中管理对象几何的增量变化。

它不是一次性生成对象后结束，而是一个带手势生命周期的连续流程。

## 处理流程

1. `process(signalPacket, deviceContext)` 接收完整信号包
2. `buildInteractionContext(signalPacket, deviceContext)` 解析 `position`、结束信号、`objectId`、`ownerChunkId` 等交互信息
3. `ensureObject(interaction)` 确保当前交互已有对象实例
4. 若对象刚创建出来，则写回当前 creator 节点上下文，并加入 `activeObjectManager`
5. 根据手势状态进入 `beginCreationGesture`、`updateCreationGesture`、`completeCreationGesture` 或 `cancelCreationGesture`
6. 结束时进入 `completeCreatedObject(interaction)` 或 `cancelCreatedObject(interaction)`

## 创建完成

对象创建完成后的去向由外部工作流决定：

- **standalone**：`completeCreatedObject()` 直接调用 `AOM.apply`，把对象提交回静态图
- **handoff**：`wrapCreatorForHandoff()` 拦截 `completeCreatedObject()`，改为调用累积 `context` 中的 `onToolComplete` 回调，由 `createHandoffSubTree()` 决定后续切换与对象桥接

handoff 模式下，`autoBridgeObjects` 会把对象从 creator 节点 state 复制到 second 节点 state，供 modifier 继续消费。

这里要特别说明：

- 新的稳定契约是“调用回调通知完成”
- 个别旧工具或旧链路里仍可能保留兼容型完成信号，但它们不再代表新的首选设计
- creator 本身不再持有 modifier 引用或控制 modifier 的挂载/转发

## 几何刷新设计

对象创建工具在创建过程中也需要处理几何刷新：

- `beforeGeometryMutation(interaction)`：在几何变更前记录旧快照
- `afterGeometryMutation(interaction)`：在几何变更后请求活动层刷新，并同步推动 UI 层兼容 overlay 刷新

与 ObjectModifierTool 的不同点在于：

- 创建流程包含对象实例创建、id 分配、ownerChunkId 解析、活动对象管理和手势生命周期
- 因此不适合简单包装成一次 `withGeometryMutation(...)`
- 创建工具会在不同阶段显式调用几何刷新钩子

## 上下文共享模型

creator 通过 `setContextObjects()` 将创建的对象写回当前节点 state。
handoff 工作流中由 `createHandoffSubTree()` 的 `autoBridgeObjects` 读取 first 节点 state，并桥接到 second 节点 state。modifier 通过 `resolveContextObjects()` 读取这些共享对象。

这种共享仅在当前工作流涉及的节点路径上有效，不应当作为跨事件的全局状态使用。

## 手势模型

当前有两条基类分支：

- `SingleGestureObjectCreatorTool`：一个手势完成整个对象创建
- `MultiGestureObjectCreatorTool`：一个对象由多个手势逐步完成

对于多手势 creator，需要额外区分：

- `end` / `cancel`：只结束当前手势
- `object-end` / `object-cancel`：结束或取消整个对象创建

## 当前状态

- `SingleGestureObjectCreatorTool` 适用于单次拖拽或单次手势完成对象的场景
- `MultiGestureObjectCreatorTool` 适用于多边形这类由多次手势逐步完成的场景
- 两者都复用对象创建工具基类的几何刷新钩子
- creator / modifier 衔接由 `createHandoffSubTree()` 统一管理，creator 不再内建 modifier 挂载逻辑
- `umount()` 时 creator 会撤销未提交对象并清理上下文
