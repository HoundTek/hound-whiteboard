# 活动层渲染器文档

本文档提供 `LiveRenderer` 的概述。

活动层渲染器用于把 `ActiveObjectManager` 当前持有的活动对象，按动态层顺序绘制到 `Monitor.liveCanvas`。

它不负责决定对象是否为活动对象，也不负责决定对象最终写回到哪个区块。它只负责当前视口里的活动层显示。

## 模块定位

`LiveRenderer` 处在一条明确的边界中：

- `ActiveObjectManager` 负责回答“当前哪些对象在活动层里，以及它们的层顺序是什么”
- `Monitor` 负责回答“当前视口的缩放、原点和画布实例是什么”
- `RenderScheduler` 负责回答“何时真正执行一次 flush”
- `LiveRenderer` 负责回答“这一帧应把哪些活动对象画到 `liveCanvas` 上”

这意味着 `LiveRenderer` 是一个视口侧渲染器，而不是活动对象语义管理器。

## 输入与输出

`LiveRenderer` 当前有两个核心输入：

- `monitor`：提供 `liveCanvas`、2D context、`origin`、`zoom` 与世界到屏幕的矩形换算
- `activeObjectManager`：提供活动对象实例、层顺序、同层非活动对象图与对象范围查询能力

它的输出只有一个：

- 在当前 `Monitor.liveCanvas` 上完成一次活动层重绘

## 绘制对象来源

当前实现不会单独维护另一份“待绘制活动对象列表”。它直接从 AOM 读取当前状态。

读取路径分三层：

### 按层读取活动对象

- 遍历 `layerOrder`
- 每层先收集 `inactiveGraph` 中按拓扑序排列的非活动对象
- 再收集该层 `activeObjects` 中的活动对象

这一点保证了当前活动层绘制顺序仍与 AOM 动态层语义一致。

### 处理同层非活动对象

当前实现中，同层非活动对象不是简单按集合遍历，而是依赖 `layer.inactiveGraph.getTopologicalOrder()`。

这意味着：

- 同层中需要参与当前视觉表达的非活动对象，会先于同层活动对象绘制
- 绘制顺序仍复用 tier graph 的拓扑关系，而不是重新发明一套排序规则

### 回退路径

如果某些活动对象没有落入 `layerOrder`，当前实现还会从 `activeObjects` 再走一遍回退路径，避免对象因分层状态暂未完全同步而直接丢失显示。

## 坐标与矩形语义

`LiveRenderer` 当前已经把对象范围与屏幕脏区统一收敛到 `RectangleRange`。

关键点有两个：

- 对象世界范围通过 `getObjectWorldRect()` 统一规整为 `RectangleRange`
- 对象屏幕范围通过 `Monitor.worldRectToScreenRect()` 转成屏幕空间的 `RectangleRange`

这样做的目的是让以下几类矩形共享一套数据语义：

- 对象当前屏幕范围
- creator 或调用方显式记录的旧几何快照
- 上一帧缓存中的旧屏幕范围
- 调度器中的 dirty rect
- 局部清理时传给 `clearRect()` 的矩形

当前实现仍兼容普通 `{ left, top, width, height }` 风格的输入矩形，但进入 `LiveRenderer` 后会立刻被规范化为 `RectangleRange`。

对象屏幕矩形在换算完成后，还会叠加对象自身的 `getRenderPadding()` 留白。当前这条入口已经接到真实对象上，至少覆盖了：

- `CircleObject` 的描边半宽
- `StrokeObject` 的圆角端点与默认描边半宽
- `TextObject` 的文本框描边半宽

## 局部重绘流程

### render(dirtyRects)

`render()` 当前有两种工作模式。

#### 无参调用

无参调用表示“整层重绘”。当前行为是：

1. 收集所有活动层 drawable
2. 清空整张 `liveCanvas`
3. 按顺序重绘全部 drawable
4. 更新 `previousDrawableEntries`

这里保留全量清屏语义，是为了兼容旧调用方，避免把本来依赖整层重绘的路径静默改成局部补绘后引入漏清理。

#### 显式传入 dirtyRects

显式传入脏区时，当前行为是：

1. 规范化脏区为 `RectangleRange`
2. 只清理这些脏区
3. 只重绘与脏区相交的 drawable
4. 更新 `previousDrawableEntries`

这条路径当前已经可用于活动层的局部刷新。

### invalidateObjects(objects)

`invalidateObjects()` 是当前对象驱动刷新入口。

它不会只取对象当前位置，而是会同时取：

- 对象当前屏幕范围
- 对象通过 `captureObjectSnapshot()` 记录的旧几何快照
- 对象上一帧缓存中的旧屏幕范围

然后把这两类范围一并送给 `RenderScheduler.invalidate(...)`。

这样做的直接原因是：

- 拖拽、平移、控制点修改等操作会让对象从旧位置移动到新位置
- 某些修改可能发生在对象尚未经历上一帧 render 之前
- 如果只失效新位置，旧位置上的像素不会被清除
- 因此当前协议同时依赖“显式旧几何快照”和“上一帧 drawable 缓存”两条来源，而不再只押注后一者

### captureObjectSnapshot(objects)

`captureObjectSnapshot()` 是当前旧几何快照协议的显式入口。

它的作用是：

- 在对象几何即将被修改前，先记录对象当前屏幕范围
- 若同一对象在一次 flush 前连续发生多次修改，则把多次旧范围合并成一个并集矩形

当前高频修改路径里，creator 工具已经会在几何变更前调用这条接口，再在变更后调用 `invalidateObjects()`。

此外，工具侧已经把同一协议沉淀到 `ObjectModifierTool` 基类，后续真实编辑工具只要复用该基类，就可以接入同样的刷新路径；当前仓库里还没有具体 modifier 子类落地到业务流程。

## 与 RenderScheduler 的关系

`LiveRenderer` 本身不负责任务节流，也不自己调度 `requestAnimationFrame`。

当前关系是：

- `invalidateObjects()` 把脏区提交给 `monitor.renderScheduler`
- `RenderScheduler` 在合适时机调用 `LiveRenderer.flush(dirtyRects)`
- `flush()` 只是 `render()` 的薄入口，不再额外持有另一套状态

这让“调度”和“绘制”边界保持清晰。

## 当前实现状态

- 已实现：按 `layerOrder` 读取对象、同层 `inactiveGraph` 拓扑序绘制、活动对象回退路径、世界矩形到屏幕矩形换算、显式 dirty rect 局部清理与局部重绘、对象级 `getRenderPadding()`、旧范围与新范围同时失效、显式旧几何快照协议。
- 已接入：`Monitor` 已把 `RenderScheduler.flush()` 透传到 `LiveRenderer.flush(dirtyRects)`；`ActiveObjectManager.add/choose/apply/discard` 已会主动触发 `LiveRenderer.invalidateObjects(...)`；`stroke-creator` 与 `polygon-creator` 这类高频几何修改路径已会在变更前记录快照、变更后请求活动层刷新；`ObjectModifierTool` 已具备统一的几何变更包装钩子。
- 已兼容：无参 `render()` 仍保持整层重绘语义；传入普通矩形对象时仍会被兼容处理。
- 待完善：dirty rect 的合并策略仍较基础；对象级 padding 目前只覆盖了少数高频对象，尚未扩展成完整对象族策略；`baseCanvas` / `uiCanvas` 的专用渲染器尚未补齐；真实 modifier 子类尚未接入这套快照协议。

## 相关文档

- [monitor-document.md](./monitor-document.md)
- [active-object-manager-document.md](./active-object-manager-document.md)
- [tier-graph-document.md](./tier-graph-document.md)
