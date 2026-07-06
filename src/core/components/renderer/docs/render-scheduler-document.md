# 渲染调度器文档

本文档提供 `RenderScheduler` 的概述。

渲染调度器用于把多次连续的失效请求合并到一次 flush 中执行。它不关心对象语义，也不直接操作任何画布。它只负责“何时把一批脏区交给渲染器处理”。

## 模块定位

`RenderScheduler` 当前是各渲染器内部的通用调度层。每个 `BaseRenderer`、`LiveRenderer`、`UiRenderer` 在构造时各自创建自己的 `_scheduler` 实例。

它的边界是：

- 不决定某个对象是否需要刷新
- 不计算对象世界范围
- 不负责真正绘制对象
- 只管理 dirty rect 的积累、调度与 flush 触发

在当前渲染链路中，它位于 `Viewport` 和 `LiveRenderer` 之间。

## 核心职责

当前实现里，`RenderScheduler` 只有三项职责：

### 积累脏区

调用 `invalidate(rect)` 时，调度器会把传入的脏区压入 `dirtyRects`。

这一步只做收集，不做真正绘制。

### 控制单帧调度

调度器通过 `framePending` 保证：

- 在同一帧周期里，多次 `invalidate(...)` 只会触发一次调度
- 后续的失效请求只追加脏区，不重复排队新帧

这就是它的核心节流语义。

### 在 flush 前合并脏区

真正执行 `flush()` 时，调度器会：

1. 复制当前 `dirtyRects`
2. 调用 `mergeDirtyRects(...)`
3. 清空内部积压脏区
4. 调用 `flushHandler(mergedRects)`

这意味着“脏区如何合并”和“脏区最终交给谁处理”都可替换，而调度器本身只保留最小控制逻辑。

## 当前数据结构

### framePending

- 类型：`boolean`
- 含义：当前是否已经有一帧待执行

它用于防止重复调度。

### dirtyRects

- 类型：数组
- 含义：当前帧周期内积累的脏区集合

当前实现对数组元素类型保持开放，原因是 `RenderScheduler` 本身不应绑死到某一种具体矩形结构上。

在当前活动层渲染链里，传入的实际数据通常是 `RectangleRange`。

### scheduleFrame

- 类型：调度函数
- 默认行为：优先使用 `requestAnimationFrame`，否则退回 `setTimeout(..., 16)`

这个字段存在的意义是把“时间调度”从实现里抽离出来，方便测试与宿主替换。

### mergeDirtyRects

- 类型：脏区合并函数
- 默认行为：对 `RectangleRange` 做一轮“相交/相接必合并，近邻且额外扫描面积可控时也合并”的聚合；非矩形输入保持原样透传

当前默认实现已经不只是简单并集：

- 相交或相接矩形会直接合并
- 横向或纵向间隔很小的近邻矩形，也会在额外扫描面积可控时合并
- 过远、或合并后会引入过大空白区域的矩形，会保持分离

这意味着当前策略更偏向“减少高频操作时的小矩形数量”，但仍然会控制过度合并带来的额外扫描面积。

当前实现还支持按宿主注入不同参数：

- live 层可使用更激进的近邻合并阈值，因为它天然以整视口为渲染边界
- base 层可使用更保守的近邻合并阈值，并额外支持“覆盖足够多时退化为整 chunk”
- 两层都可以在脏区已经接近整视口时，直接退化为整视口重绘，避免继续维护大量碎片矩形

这些参数可以按调用时动态读取，例如直接绑定到 `viewport.zoom`：

- 近邻距离阈值可随 `zoom` 线性放大
- 额外扫描面积阈值可随 `zoom^2` 放大
- `viewportCoverageRatio` 与 `canonicalRectCoverageRatio` 也可随 `zoom` 提高而变得更严格，避免高倍缩放时过早退化为整视口或整 chunk

若宿主不想把这些值逐项散开传入，当前还可以直接提供 `getThresholds()`：

- `getThresholds()` 返回一整组当前阈值
- 单独传入的字段仍可覆盖 `getThresholds()` 中的同名值
- 这样可以把 zoom-aware 规则集中到独立策略模块里，再由宿主按帧读取

在更上一层，宿主还可以自己维护一份 per-layer dirty rect policy：

- policy 内统一组织 `getThresholds()`、`getViewportRect()`、`getCanonicalRectsForRect()`
- `RenderScheduler` 本身不关心 policy 如何生成，它只消费这些回调的返回值
- 这样 base/live 的差异可以集中在宿主的 policy resolver，而不是散落在 merger 调用点
- 例如 base policy resolver 可以直接封装“屏幕 dirty rect 到世界矩形，再到 loaded chunk 子集”的候选解析逻辑

这样做的目的，是让高倍缩放和低倍缩放下的 dirty rect 聚合更接近同一份世界空间语义，而不是被固定屏幕像素阈值绑死。

### flushHandler

- 类型：flush 回调
- 默认行为：空函数

在当前 Viewport 链路中，`flushHandler` 最终会指向 `LiveRenderer.flush(dirtyRects)`。

## 工作流程

### invalidate(rect)

调用 `invalidate(rect)` 后：

1. 若传入了脏区，则加入 `dirtyRects`
2. 若当前已有待执行帧，则直接返回 `false`
3. 若当前没有待执行帧，则标记 `framePending = true`
4. 调用 `scheduleFrame(() => this.flush())`
5. 返回 `true`

这里的返回值表达的是“这次调用是否新启动了一次调度”，而不是“这次调用是否真的提交了脏区”。

### flush()

调用 `flush()` 后：

1. 使用 `mergeDirtyRects([...this.dirtyRects])` 得到本次要处理的脏区
2. 复位 `framePending`
3. 清空内部脏区缓存
4. 调用 `flushHandler(mergedRects)`

因此，`flush()` 是真正把调度状态转换为渲染动作的边界点。

### clear()

`clear()` 只负责清空积压脏区，不负责取消已经排队的帧。

这说明当前调度器没有引入更复杂的“取消帧”或“替换帧任务”语义，而是保持最小实现。

## 与各渲染器之间的关系

当前接入方式是每个渲染器在构造时创建自己的 `_scheduler`：

- `BaseRenderer._initScheduler()` 创建 `_scheduler`，flush handler 绑定到 `this.flush`
- `LiveRenderer._initScheduler()` 创建 `_scheduler`，flush handler 绑定到 `this.flush`
- `UiRenderer` 构造时直接创建 `_scheduler`，flush handler 绑定到 `this.flush`

各渲染器通过 `this.invalidate(rect)` 提交脏区到自己的调度器。

这里的职责边界很明确：

- `RenderScheduler` 决定何时 flush
- 渲染器决定 flush 时画什么
- Viewport 负责触发时机（视口变化、区块变化等），由 Viewport 调用渲染器的 `invalidate()` / `invalidateViewport()` 推动渲染

## 当前实现状态

- 已实现：多次 `invalidate(...)` 合并到单次调度、可替换的 `scheduleFrame`、可替换的 `mergeDirtyRects`、可替换的 `flushHandler`、手动 `flush()` 与 `clear()`。
- 已验证：同一帧周期内的多次失效请求只会触发一次调度；`flush()` 会先走 `mergeDirtyRects(...)` 再调用处理器。
- 已接入：`BaseRenderer`、`LiveRenderer`、`UiRenderer` 均在内部持有 `_scheduler` 实例，各渲染器的 `invalidate()` 直接委托给 `_scheduler.invalidate()`。
- 已实现的默认聚合：重叠/相接矩形合并、近邻矩形的受控合并、非矩形输入透传。
- 已实现的宿主参数化：base/live 可分别注入不同阈值；并支持“整视口 / 整 chunk”退化。
- `collapseLargeRect`：当脏区覆盖某个 canonical rect（如 chunk 屏幕矩形）超过 `canonicalRectCoverageRatio` 时，该脏区退化为整 canonical rect；覆盖率不足时保留脏区与该 canonical rect 的交集，避免跨区块对象在低覆盖率 chunk 上丢失渲染。
- 待完善：更强的聚类策略、按操作类型动态调整阈值、不同渲染层按真实代价模型继续细化参数。

## 相关文档

- [viewport-document.md](../../orchestration/docs/viewport-document.md)
- [live-renderer-document.md](./live-renderer-document.md)
