# 对象创建工具文档

## 概述

对象创建工具负责在白板上生成新对象，并在创建过程中管理对象几何的增量变化。

它不是一次性生成对象后结束，而是一个带手势生命周期的连续流程。

## 处理流程

1. process(signalPacket, deviceContext) 接收完整信号包
2. buildInteractionContext(signalPacket, deviceContext) 解析 position、结束信号、objectId、ownerChunkId 等交互信息
3. ensureObject(interaction) 确保当前交互已有对象实例
4. 若对象刚创建出来，则写回当前 creator 节点上下文，并加入 activeObjectManager
5. 根据手势状态进入 beginCreationGesture、updateCreationGesture、completeCreationGesture 或 cancelCreationGesture
6. 结束时进入 completeCreatedObject(interaction) 或 cancelCreatedObject(interaction)

## 创建完成

对象创建完成后，由外部 `createHandoffSubTree` 决定后续流程：
- **standalone**：`completeCreatedObject` 直接调用 AOM.apply 提交到静态图
- **handoff**：`wrapCreatorForHandoff` 拦截完成信号并发出 `TOOL_COMPLETE`，handoff 状态机切换到 modifier，`autoBridgeObjects` 将对象从 creator 节点状态桥接到 modifier 节点状态

creator 本身不再持有 modifier 引用或控制 modifier 的挂载/转发。全部衔接逻辑由 `src/core/prefixs/handoff-handler.js` 中的 `createHandoffSubTree` 统一管理。

## 几何刷新设计

对象创建工具在创建过程中也需要处理几何刷新：

- beforeGeometryMutation(interaction)：在几何变更前记录旧快照
- afterGeometryMutation(interaction)：在几何变更后请求活动层刷新，并同步推动 ui 层兼容 overlay 刷新

与 ObjectModifierTool 的不同点在于：

- 创建流程包含对象实例创建、id 分配、ownerChunkId 解析、活动对象管理和手势生命周期
- 因此不适合简单包装成一次 withGeometryMutation(...)
- 创建工具会在不同阶段显式调用几何刷新钩子

当前这条 ui 刷新仍应理解为兼容行为：

- Core 先保证选中框等 overlay 能跟上对象创建中的几何变化
- chooser 轨迹、控制杆、激光笔等更完整的 UI 语义，后续仍可能转交给宿主 UI 侧 overlay 系统

但这里要注意：

- creator 触发 ui 层刷新，不代表 creator 本身就是默认选择框来源
- 当前默认选择框仍只来自 chooser / modifier 的节点上下文
- creator 侧的 ui 刷新更多是在兼容链路里保证已有 overlay 不滞后

## 上下文共享模型

creator 通过 `setContextObjects()` 将创建的对象写回当前节点 state。
handoff 工作流中由 `createHandoffSubTree` 的 `autoBridgeObjects` 读取 first 节点 state
并桥接到 second（modifier）节点 state。modifier 通过 `resolveContextObjects()` 读取这些共享对象。

这种共享仅在当前工作流涉及的节点路径上有效，不应当作为跨事件的全局状态使用。

## 当前状态

- SingleGestureObjectCreatorTool 适用于一个手势完成整个对象创建的场景
- MultiGestureObjectCreatorTool 适用于一个对象由多个手势逐步完成的场景
- 两者都复用对象创建工具基类的几何刷新钩子
- creator / modifier 衔接由 `createHandoffSubTree` 统一管理，creator 不再内建 modifier 挂载逻辑
- umount 时 creator 会撤销未提交对象并清理上下文
