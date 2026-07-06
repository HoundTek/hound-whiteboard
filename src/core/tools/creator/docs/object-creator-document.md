# 对象创建工具文档

## 概述

对象创建工具负责把输入手势转换为"一个正在创建中的对象"。

当前 creator 族运行在 UI 线程，但真实对象创建发生在 Worker 侧：

- UI 线程维护手势期本地状态 `_entry`（遵循 `LightweightObjectEntry` 协议）
- Worker 侧通过 `BoardApiRpc` 创建真实对象并进入 AOM
- 完成后由 creator 自己决定提交到静态图，或交给 handoff 中的 modifier 继续处理

## 当前本地状态模型

creator 不再持有本地 `BasicObject` 实例。

当前统一使用 `_entry` 纯数据对象，遵循 `LightweightObjectEntry` 协议：

```js
{
  id: number,
  type: string,                      // 对象类型名（如 "StrokeObject"）
  position: Vector | { x, y },
  boundingBox?: { left, top, width, height },  // 完成创建后回填
  property: Record<string, any>,
  data: Record<string, any>,         // 类型专属几何数据
}
```

其职责是：

- 维护手势期几何状态
- 供 handoff / node state / 测试读取
- 在 UI 线程上同步更新本地草稿

Worker 侧真实对象与 `_entry` 通过 `objectId` 关联，但引用互不共享。

## 完成时回填 `boundingBox`

`finalizeCreatedObject` 中调用 `resolveCreatedObjectBoundingBox()` 钩子，将计算出的局部外接矩形写入 `_entry.boundingBox`。

各子类的实现：

| 子类                 | 计算方式                                                       |
| -------------------- | -------------------------------------------------------------- |
| `StrokeCreatorTool`  | `data.points` 的 min/max                                       |
| `CircleCreatorTool`  | `data.radius` → `{ left: -r, top: -r, width: 2r, height: 2r }` |
| `PolygonCreatorTool` | `data.points` 的 min/max                                       |

回填 `boundingBox` 后，当 handoff 把 `_entry` 桥接给 modifier 时，modifier 可以直接做准入检测（`resolveModifiedObjectWorldRect`）和 overlay 渲染。

## objectId 分配

creator 在 `ensureObject(interaction)` 中按需分配 `objectId`：

1. 若输入上下文已携带 `interaction.objectId`，直接复用
2. 否则调用 `board.allocateObjectId()`
3. `Board` 在 UI 线程用本地 `CounterPool` 同步分配新 id
4. 后续 `boardApi.createObject(type, { id, ... })` 必须显式携带该 id

Worker 侧若发现重复 id，会通过 RPC 抛错返回。

## 创建与修改路径

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

### 渲染失效

Core 侧的 mutation RPC handler 在修改 AOM 对象后自动触发 live 层脏区失效与立即 flush，
使帧回传与 UI overlay 保持同步。creator 的 `afterGeometryMutation` 仅负责 UI overlay 刷新。

### 提交 / 撤销

- 提交：`boardApi.commitObjects([objectId])`
- 撤销：`boardApi.discardActiveObjects([objectId])`

## 手势流程

### `SingleGestureObjectCreatorTool`

适用于单次手势完成整个对象创建的工具，例如：

- `StrokeCreatorTool`
- `CircleCreatorTool`

流程：

1. 首个 `position` → `ensureObject()` → `beginGesture()`
2. 后续 `position` → `updateGesture()`
3. `end` → `completeGesture()` → `completeAction()`
4. `cancel` → `cancelGesture()` → `discardAction()`

`GestureTool.process()` 自动编排：首个 position 触发 begin，后续 position 触发 update，end 触发 completeGesture + `autoActionOnGestureEnd ? completeAction : nop`。

### `MultiGestureObjectCreatorTool`

适用于多次手势逐步构造一个对象的工具，例如：

- `PolygonCreatorTool`

多手势语义通过覆写 `GestureTool._onEnd/_onCancel/_onObjectEnd/_onObjectCancel` 实现：

- `end` / `cancel` 只结束当前手势
- `object-end` / `object-cancel` 才结束整个对象

## 生命周期钩子

### `beforeCommitCreatedObject(interaction)`

决定 `finalize` 后是否把对象提交到静态图。

- 默认返回 `true`
- handoff 模式下通过注入 `context.acc.autoCommit = false` 阻止提交，对象继续留在 AOM 动态图中

### `afterCompleteCreatedObject(interaction, completedObject)`

创建流程完成后的扩展钩子。

`action:complete` 事件在 `completeAction` 中统一触发。

## 与 handoff 的关系

creator 不直接持有 modifier 引用。

handoff 的接入点：

1. `beforeCommitCreatedObject()` — 被 `context.acc.autoCommit` 取代拦截职责
2. `action:complete` 事件 — handoff `wrapToolForHandoff` 订阅该事件

创建完成后，handoff wrapper 从 `action:complete` 事件结果中取得 `_entry`，通过 `context.acc.setHandoffObjects()` 写入 handoff 闭包变量。下次 dispatch 时 `resolveTransition` 从闭包读取，通过 `acc.objects` 注入给 modifier。

## 子类差异

### `StrokeCreatorTool`

- `_entry.data.points` 维护局部路径点列
- 每次 position 追加一个点

### `CircleCreatorTool`

- `_entry.data.radius` 维护半径
- 小拖拽距离会回退到固定半径策略

### `PolygonCreatorTool`

- `_entry.data.points` 维护顶点列表
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
