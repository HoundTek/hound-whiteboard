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

## BoardApi 双路径

P2 迁移后，ObjectCreatorTool 支持两条创建路径，通过 `context.acc.boardApi` 是否注入来决定：

- **BoardApi 路径**：工具通过 `boardApi.createObject(type, props)` 创建对象，通过 `boardApi.commitObjects()` / `boardApi.discardActiveObjects()` 提交或撤销。渲染脏区由 BoardApi 内部自动触发。
- **Legacy 路径**：工具直接 `new CircleObject(id, pos)`、`AOM.add()`、`monitor.liveRenderer.invalidateObjects()`。用于未接入 boardApi 的上下文。

两条路径的切换细节：

| 阶段            | BoardApi 路径                                                   | Legacy 路径                                                              |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 创建            | `boardApi.createObject(type, { id, position, property, data })` | `this.create(id, position)` + `AOM.add()` + `syncCreatedObjectContext()` |
| 提交            | `boardApi.commitObjects([objectId])`                            | `AOM.apply(new Set([obj]))`                                              |
| 取消            | `boardApi.discardActiveObjects([objectId])`                     | `AOM.discard(new Set([obj]))`                                            |
| 几何脏区        | Core 自动触发 `aomRenderHooks.requestLiveRender`                | `monitor.liveRenderer.captureObjectSnapshot` + `invalidateObjects`       |
| UI overlay 刷新 | 保留 `requestUiOverlayRefresh`                                  | 保留 `requestUiOverlayRefresh`                                           |

BoardApi 路径下，工具仍然保留 `this.obj` 作为兼容对象引用，handoff / `context.acc.objects` 等下游依赖不受影响。

### 子类接入点

子类通过以下钩子为 BoardApi 路径提供必要信息：

- `getCreatedObjectType()`：返回对象类型名字符串（如 `"CircleObject"`）。返回 `undefined` 时强制走 Legacy 路径。
- `resolveCreatedObjectProperty(interaction)`：返回初始属性合并块，默认合并 `this.property` 与注入属性。
- `resolveCreatedObjectData(interaction)`：返回初始专属数据（如 Circle 的 `{ radius: 0 }`）。

## 创建完成生命周期

`completeCreatedObject(interaction)` 是创建流程的统一入口，内部按生命周期钩子编排：

```
completeCreatedObject(interaction)
  │
  ├─ ① finalizeCreatedObject()        ← 总是执行（同步上下文、标记完成）
  │
  ├─ ② beforeCommitCreatedObject()    ← 控制型钩子，返回 bool
  │     ├─ true (默认) → commitCreatedObject()  → BoardApi.commitObjects / AOM.apply → 进入静态图
  │     └─ false (handoff 模式) → 跳过提交，对象留在 AOM 动态图中
  │
  └─ ③ afterCompleteCreatedObject()   ← 通知型钩子，触发 "afterCreate" 事件
```

### 控制型钩子：`beforeCommitCreatedObject`

决定 `finalize` 之后是否将对象提交到静态图。handoff 工作流覆盖此钩子返回 `false`，阻止 creator 将对象推入静态图，对象留在 AOM 动态图中等待 modifier 最终提交。

```js
// 默认：提交到静态图
beforeCommitCreatedObject(interaction) {
  return true;
}

// Handoff 覆盖：阻止提交
creator.beforeCommitCreatedObject = () => false;
```

### 通知型钩子：`afterCompleteCreatedObject`

对象创建流程完成时触发（无论是否 commit），对外发出 `"afterCreate"` 事件：

```js
// Handoff 订阅完成通知
creator.on("afterCreate", (interaction, obj) => {
  // 对象已完工，可桥接到 modifier
});
```

### 与 handoff 协作

- **standalone**：`beforeCommitCreatedObject` 返回 `true`，对象直接进入静态图
- **handoff**：handoff 覆盖 `beforeCommitCreatedObject` 返回 `false`，订阅 `"afterCreate"` 完成桥接与状态切换

handoff 模式下，`autoBridgeObjects` 会把对象从 creator 节点 state 复制到 second 节点 state，供 modifier 继续消费。

这里要特别说明：

- creator 本身不再持有 modifier 引用或控制 modifier 的挂载/转发
- 钩子系统使得 handoff 无需替换 creator 的任何方法
- creator 的原始 `completeCreatedObject` 逻辑完整保留，只在钩子处接入

## 几何刷新设计

对象创建工具在创建过程中也需要处理几何刷新：

- `beforeGeometryMutation(interaction)`：在几何变更前记录旧快照。BoardApi 路径下跳过（由 Core 自动处理）。
- `afterGeometryMutation(interaction)`：在几何变更后请求渲染刷新。BoardApi 路径下仅保留 UI overlay 刷新，渲染脏区由 Core 自动处理。

与 ObjectModifierTool 的不同点在于：

- 创建流程包含对象实例创建、id 分配、ownerChunkId 解析、活动对象管理和手势生命周期
- 因此不适合简单包装成一次 `withGeometryMutation(...)`
- 创建工具会在不同阶段显式调用几何刷新钩子

## 状态字段

ObjectCreatorTool 基类新增以下字段用于 BoardApi 路径：

| 字段                           | 类型             | 说明                                   |
| ------------------------------ | ---------------- | -------------------------------------- |
| `objectId`                     | `number \| null` | 当前创建对象的 id 令牌                 |
| `_usesBoardApiObjectLifecycle` | `boolean`        | 当前对象是否通过 BoardApi 生命周期创建 |

Legacy 路径下 `_usesBoardApiObjectLifecycle` 保持 `false`，`objectId` 仍写为 `interaction.objectId` 但不影响行为。

## 上下文共享模型

creator 通过 `setContextObjects()` 将创建的对象写回当前节点 state。
handoff 工作流中由 `createHandoffSubDAG()` 的 `autoBridgeObjects` 读取 first 节点 state，并桥接到 second 节点 state。modifier 通过 `resolveContextObjects()` 读取这些共享对象。

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
- creator / modifier 衔接由 `createHandoffSubDAG()` 统一管理，creator 不再内建 modifier 挂载逻辑
- `umount()` 时 creator 会撤销未提交对象并清理上下文
- P2 BoardApi 迁移已完成：CircleCreatorTool、StrokeCreatorTool、PolygonCreatorTool 均已接入 BoardApi 双路径
