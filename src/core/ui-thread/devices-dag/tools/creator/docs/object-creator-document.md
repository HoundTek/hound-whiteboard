# 对象创建工具文档

## 概述

对象创建工具负责把输入手势转换为"一个正在创建中的对象"。

每个形状的创建工具拆分为两部分：

- **数据创建器**（Tool，挂在设备图上）：负责草稿初始化、RPC 创建/提交、外接矩形解析等数据侧职责
- **手势 processor**（策略对象，组合进数据创建器）：负责把 position 流解释为数据补丁，承担全部手势解释逻辑

当前 creator 族运行在 UI 线程，但真实对象创建发生在 Worker 侧：

- UI 线程维护手势期本地状态 `_entry`（遵循 `LightweightObjectEntry` 协议）
- Worker 侧通过 `BoardApiRpc` 创建真实对象并进入 AOM
- 完成后由 creator 自己决定提交到静态图，或交给 handoff 中的 modifier 继续处理

## 数据创建器 + 手势 processor

手势与数据的拆分动机：同一个形状可以有多种创建手势（圆 = 圆心+半径 / 直径 / 外接矩形），
同一种手势也可以服务多个形状（外接矩形拖拽可以创建矩形、椭圆）。

### 契约：interpret 纯函数

手势的本质是"把 position 流编译为 `modifyObject` 补丁序列"。两点手势族
（`gesture/two-point-processor.js` 的 `TwoPointGestureProcessor`）统一实现状态机：

- 手势开始点记为**锚点**，最近位置记为**当前点**
- 每次空间更新调用 `interpret(anchor, current)` 纯函数，得到补丁：

```js
{ position?, data?, transform? }   // 形状与 boardApi.modifyObject(objectId, patch) 的补丁契约一致
```

- 补丁经 creator 的 `applyGesturePatch(patch, interaction)` 应用：先更新本地 `_entry`，
  再 fire-and-forget 经 RPC 同步 Worker 侧

手势间差异全部下沉为配置（`interpret` / `collectOverlay` / `resolveFallbackPatch` 三个纯函数），
processor 类本身不含形状专属逻辑。数据创建器通过必传构造参数 `processor` 组合手势（无默认手势）：

```js
new CircleDataCreatorTool({
  property: { strokeColor: "#00aa00" },
  processor: createCircleRadiusProcessor(), // 或 diameter
});
```

### 圆的两种手势

| processor 工厂                    | interpret 语义                                     |
| --------------------------------- | -------------------------------------------------- |
| `createCircleRadiusProcessor()`   | 锚点为圆心，`\|c−a\|` 为半径                       |
| `createCircleDiameterProcessor()` | 锚点与当前点为直径两端，位置取中点，半径取距离一半 |

### 椭圆：独立对象，外接矩形手势

椭圆由独立的 `EllipseObject` 表达（`data: { radiusX, radiusY }`，position 为椭圆中心），
不经 circle + transform 硬凑。`EllipseDataCreatorTool` 组合 `createEllipseBoundingProcessor()`：
锚点与当前点为外接矩形对角，interpret 产出
`{ position: 矩形中心, data: { radiusX: w/2, radiusY: h/2 } }`。

## 当前本地状态模型

creator 不再持有本地 `BasicObject` 实例。

当前统一使用 `_entry` 纯数据对象，遵循 `LightweightObjectEntry` 协议：

```js
{
  id: number,
  type: string,                      // 对象类型名（如 "StrokeObject"）
  position: Vector | { x, y },
  transform?: { a, b, c, d },        // 由手势补丁写入（对象变换）
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

这一步是**强制校验**而非君子协定：`resolveCreatedObjectBoundingBox()` 是抽象方法，
`finalizeCreatedObject` 会校验 `entry.type` 与 `getCreatedObjectType()` 一致且
boundingBox 非空，违例直接抛错——modifier 的准入检测（`resolveModifiedObjectWorldRect`）
和 overlay 渲染依赖这些字段，缺失时显式失败好过对象静默不可选。

各子类的实现：

| 子类                     | 计算方式                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `StrokeCreatorTool`      | `data.points` 的 min/max                                                            |
| `CircleDataCreatorTool`  | `rx = r·hypot(a, b)`、`ry = r·hypot(c, d)`（transform 感知；无 transform 时为正圆） |
| `EllipseDataCreatorTool` | `rx = radiusX·hypot(a, b)`、`ry = radiusY·hypot(c, d)`（transform 感知）            |
| `PolygonCreatorTool`     | `data.points` 的 min/max                                                            |

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

这条调用保持 **fire-and-forget**。回执经 `rpc-response` 异步返回：创建失败时
`handleCreationFailure` 会清理本地草稿、置失败闩锁（阻断同一手势内的重复创建与无效 RPC），
闩锁在 `end` / `umount` 后解除——UI 的 `_entry` 不会与 Worker 状态静默分叉。

### 高频几何更新

- `StrokeCreatorTool` → `boardApi.appendListItem(id, "points", [...])`
- `CircleDataCreatorTool` → `applyGesturePatch()` → `boardApi.modifyObject(id, patch)`（patch 可含 `position` / `data` / `transform`）
- `PolygonCreatorTool` → `boardApi.appendListItem(...)` / `replaceListItem(...)`

这些调用也保持 fire-and-forget。

### 渲染失效

Core 侧的 mutation RPC handler 在修改 AOM 对象后自动触发 live 层脏区失效与立即 flush，
使帧回传与 UI overlay 保持同步。creator 的 `afterGeometryMutation` 仅负责 UI overlay 刷新。

### 提交 / 撤销

- 提交：`boardApi.commitObjects([objectId])`——Worker 返回实际提交的 id 列表，
  creator 对回执对账，期望 id 缺失时告警（对象静默丢失的最后一张网）
- 撤销：`boardApi.discardActiveObjects([objectId])`

## 手势流程

### `SingleGestureObjectCreatorTool`

适用于单次手势完成整个对象创建的工具，例如：

- `StrokeCreatorTool`
- `CircleDataCreatorTool`

流程：

1. 首个 `position` → `ensureObject()` → `beginGesture()`
2. 后续 `position` → `updateGesture()`
3. `end` → `completeGesture()` → `completeAction()`
4. `cancel` → `cancelGesture()` → `discardAction()`

`GestureTool.process()` 自动编排：首个 position 触发 begin，后续 position 触发 update，end 触发 completeGesture + `autoActionOnGestureEnd ? completeAction : nop`。

组合了 processor 的 creator（如 `CircleDataCreatorTool`）将这四个手势钩子与
overlay 收集全部委托给 processor，自身只保留数据侧实现。

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
- 实例属性 `autoCommit`（默认 `true`）为 `false` 时跳过 commit，对象继续留在 AOM 动态图中
- `HandoffWrapperTool` 接管 creator 时会在构造期把 `autoCommit` 置为 `false`

### `afterCompleteCreatedObject(interaction, completedObject)`

创建流程完成后的扩展钩子。

`action:complete` 事件在 `completeAction` 中统一触发。

## 与 handoff 的关系

creator 不直接持有 modifier 引用。

`HandoffWrapperTool` 的接入点：

1. 构造期把 creator 的实例属性 `autoCommit` 置为 `false`，阻止对象提前进入静态图
2. 构造期一次性订阅 creator 的 `action:complete` 事件

创建完成后，wrapper 从 `action:complete` 事件结果中取得 `_entry`，通过 modifier 的 `receiveHandoffObjects(objects, context)` 桥接给 modifier。

## 子类差异

### `StrokeCreatorTool`

- `_entry.data.points` 维护局部路径点列
- 每次 position 追加一个点

### `CircleDataCreatorTool`

- `_entry.data.radius` 维护半径
- 手势解释全部由组合的 processor 承担（圆心+半径 / 直径）；点击未拖动时由
  processor 的 `resolveFallbackPatch` 回退到固定半径策略

### `EllipseDataCreatorTool`

- `_entry.data.radiusX` / `radiusY` 维护双轴半径，position 为椭圆中心
- 手势解释由组合的 processor 承担（外接矩形），fallback 同样回退到固定半径

### `PolygonCreatorTool`

- `_entry.data.points` 维护顶点列表
- 通过 `appendPoint()` / `replacePoint()` 更新当前顶点

## 当前状态

- creator 族已全面适配 Worker mode
- 本地状态不再依赖 `BasicObject` 子类实例
- objectId 由 UI 侧 `Board` 同步分配
- Worker 侧 create error 由 `handleCreationFailure` 兜底（清理草稿 + 失败闩锁），commit 回执对账
- circle / ellipse 已完成「数据创建器 + 手势 processor」拆分：圆支持圆心+半径 / 直径两种手势，椭圆经独立 `EllipseObject` + 外接矩形手势创建；stroke / polygon 待跟进

## 相关文档

- [object-modifier-document.md](../../modifier/docs/object-modifier-document.md)
- [object-chooser-document.md](../../chooser/docs/object-chooser-document.md)
- [wrapper-document.md](../../wrapper/docs/wrapper-document.md)
- [core-data-model.md](../../../../../docs/core-data-model.md)
- [core-runtime-boundaries.md](../../../../../docs/core-runtime-boundaries.md)
