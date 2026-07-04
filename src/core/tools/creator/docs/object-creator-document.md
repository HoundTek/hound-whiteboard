# 对象创建工具文档

## 概述

对象创建工具负责把输入手势转换为“一个正在创建中的对象”。

当前 creator 族运行在 UI 线程，但真实对象创建发生在 Worker 侧：

- UI 线程维护手势期本地状态 `_local`
- Worker 侧通过 `BoardApi` / `BoardApiRpc` 创建真实对象并进入 AOM
- 完成后由 creator 自己决定提交到静态图，或交给 handoff 中的 modifier 继续处理

## 当前本地状态模型

creator 不再持有本地 `BasicObject` 实例。

当前统一使用 `_local` 纯数据对象：

```js
{
  id,
  position: Vector,
  property: Record<string, any>,
  data: Record<string, any>,
}
```

其职责是：

- 维护手势期几何状态
- 供 handoff / node state / 测试读取
- 在 UI 线程上同步更新本地草稿

Worker 侧真实对象与 `_local` 通过 `objectId` 关联，但引用互不共享。

## objectId 分配

creator 在 `ensureObject(interaction)` 中按需分配 `objectId`：

1. 若输入上下文已携带 `interaction.objectId`，直接复用
2. 否则调用 `board.allocateObjectId()`
3. `Board` 在 UI 线程用本地 `CounterPool` 同步分配新 id
4. 后续 `boardApi.createObject(type, { id, ... })` 必须显式携带该 id

Worker 侧若发现重复 id，会通过 RPC 抛错返回。

## BoardApi 路径

当前 creator 族主路径如下：

### 创建

```js
boardApi.createObject(type, {
  id,
  position,
  property,
  data,
});
```

这条调用保持 **fire-and-forget**。当前已额外包裹 `Promise.resolve(...).catch(...)`，防止 Worker 侧 create error 变成 unhandled rejection。

### 高频几何更新

- `StrokeCreatorTool` → `boardApi.appendListItem(id, "points", [...])`
- `CircleCreatorTool` → `boardApi.modifyObject(id, { data: { radius } })`
- `PolygonCreatorTool` → `boardApi.appendListItem(...)` / `replaceListItem(...)`

这些调用也保持 fire-and-forget。

### 提交 / 撤销

- 提交：`boardApi.commitObjects([objectId])`
- 撤销：`boardApi.discardActiveObjects([objectId])`

## 手势流程

### `SingleGestureObjectCreatorTool`

适用于单次手势完成整个对象创建的工具，例如：

- `StrokeCreatorTool`
- `CircleCreatorTool`

流程：

1. 首个 `position` → `ensureObject()` → `beginCreationGesture()`
2. 后续 `position` → `updateCreationGesture()`
3. `end` → `completeCreationGesture()` → `completeCreatedObject()`
4. `cancel` → `cancelCreatedObject()`

### `MultiGestureObjectCreatorTool`

适用于多次手势逐步构造一个对象的工具，例如：

- `PolygonCreatorTool`

流程：

- `end` / `cancel` 只结束当前手势
- `object-end` / `object-cancel` 才结束整个对象

## 生命周期钩子

### `beforeCommitCreatedObject(interaction)`

决定 `finalize` 后是否把对象提交到静态图。

- 默认返回 `true`
- handoff 模式下覆盖为 `false`，对象继续留在 AOM 动态图中

### `afterCompleteCreatedObject(interaction, completedObject)`

创建流程完成后触发 `afterCreate` 事件。handoff 通过它从 creator 切换到 modifier。

## 与 handoff 的关系

creator 不直接持有 modifier 引用。

handoff 的接入点只有两处：

1. `beforeCommitCreatedObject()`
2. `afterCreate` 生命周期事件

当前 `autoBridgeObjects` 会把 creator 节点 state 中的 `_local` 条目桥接给 modifier 节点，供后续修改继续使用。

## 子类差异

### `StrokeCreatorTool`

- `_local.data.points` 维护局部路径点列
- 每次 position 追加一个点

### `CircleCreatorTool`

- `_local.data.radius` 维护半径
- 小拖拽距离会回退到固定半径策略

### `PolygonCreatorTool`

- `_local.data.points` 维护顶点列表
- 通过 `appendPoint()` / `replacePoint()` 更新当前顶点

## 当前状态

- creator 族已全面适配 Worker mode
- 本地状态不再依赖 `BasicObject` 子类实例
- objectId 由 UI 侧 `Board` 同步分配
- Worker 侧 create error 已有 Promise catch 兜底

## 相关文档

- [object-modifier-document.md](../../modifier/docs/object-modifier-document.md)
- [object-chooser-document.md](../../chooser/docs/object-chooser-document.md)
- [core-data-model.md](../../../docs/core-data-model.md)
- [core-runtime-boundaries.md](../../../docs/core-runtime-boundaries.md)
