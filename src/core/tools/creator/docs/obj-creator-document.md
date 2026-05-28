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

## 创建完成策略

当前创建工具支持两种完成策略：

- apply：创建完成后直接调用 AOM.apply(...)，对象立即回到静态图
- handoff：创建完成后保持对象留在 AOM 中，并在当前 creator 节点下自动挂载固定 modifier 子工具

这里要注意一个“当前基线”和“推荐方向”的区别：

- 当前基线里，creator 的 handoff 仍由工具自身维护
- 新增 workflow 更推荐把 handoff 状态机上移到修饰节点
- 也就是说，creator 更适合只专注于对象创建本身

handoff 模式下的关键点是：

- creator 通过 setContextObjects() 把对象写回当前节点上下文
- creator 通过 syncModifierObjectContext() 把同一对象显式写入子工具路径 state，默认是 joinPath(deviceContext.path, "tool")
- creator 把后续输入通过 continueToDefaultPath() 继续送给该 modifier
- modifier 收到 apply 信号后再统一提交回静态图

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

当前 creator 与 modifier 的共享不再依赖 nodeContext 之类的隐式对象。

当前做法是：

- 当前 creator 节点通过 setContextObjects() 维护自身 object 和 objects
- 下游 modifier 节点通过 writeNodeState() 显式写入 child tool 路径的 object 和 objects
- modifier 通过 resolveContextObjects() 与 resolveNodeState() 读取这些共享对象

这种共享仅在当前工作流涉及的节点路径上有效，不应当作为跨事件的全局状态使用。

## 当前状态

- SingleGestureObjectCreatorTool 适用于一个手势完成整个对象创建的场景
- MultiGestureObjectCreatorTool 适用于一个对象由多个手势逐步完成的场景
- 两者都复用对象创建工具基类的几何刷新钩子
- 创建工具现在可配置 completionMode 与 createModifierTool
- handoff workflow 被 umount 时，creator 会撤销未提交对象并清理上下文
- prefix 驱动的多工具 handoff 已有通用 helper，但 creator / chooser 旧路径尚未整体迁移
