# 活动层渲染器文档

本文档提供 `LiveRenderer` 的概述。

`LiveRenderer` 负责把 `ActiveObjectManager` 当前持有的对象按动态层顺序绘制到 MonitorCore 的 live OffscreenCanvas 上。

这里的“当前持有”不仅包括仍处于 active layer 的活动对象，也包括仍保留在 AOM 中、但所在层已经变为 inactive 的对象。只要对象还在 AOM 里，它就应由 `LiveRenderer` 负责绘制，而不会回退给 `BaseRenderer`。

它不负责决定对象是否为活动对象，也不负责决定对象最终写回到哪个区块。它只负责当前视口里的活动层显示。

## 模块定位

`LiveRenderer` 处在一条明确的边界中：

- `ActiveObjectManager` 负责回答“当前哪些对象在活动层里，以及它们的层顺序是什么”
- `MonitorCore` 负责回答“当前视口的缩放、原点和画布实例是什么”
- `RenderScheduler` 负责回答“何时真正执行一次 flush”
- `BaseRenderer` 负责把静态对象渲染到 base OffscreenCanvas（作为 live 的缓存）
- `LiveRenderer` 负责回答“这一帧应把哪些 AOM 对象画到 `liveCanvas` 上”，并负责把 baseCanvas 缓存合成到 liveCanvas

这意味着 `LiveRenderer` 是最终的渲染出口，它的输出结果直接对应屏幕显示。

## 架构变化

`LiveRenderer` 继承自 `Renderer` 基类，自管理 liveCanvas、渲染调度器与脏区合并策略。

### 构造参数

```javascript
const renderer = new LiveRenderer(monitor, activeObjectManager, {
  canvas: liveCanvas,
});
```

- 第二参数传入 AOM 实例
- 第三参数传入 `canvas` 实例
- 构造函数内部调用 `_initScheduler()` 创建 `_scheduler`

### 内部结构

- `_canvas`：liveCanvas 引用，所有绘制操作直接读写
- `_scheduler`：`RenderScheduler` 实例，flush handler 绑定到 `this.flush`
- `_resolveThresholds`：缩放感知的脏区合并阈值策略，由 `createLiveDirtyRectThresholdStrategy()` 创建
- `_getThresholds()`：返回当前 zoom 下的阈值

### 渲染入口

- `invalidate(rect)`：提交脏区到 `_scheduler.invalidate()`
- `invalidateViewport()`：提交整视口到调度器
- `invalidateObjects(objects)`：计算对象当前/上一帧/快照的屏幕范围并通过 `this.invalidate()` 提交脏区
- `flush(dirtyRects?)` → `render(dirtyRects?)`：基类模板方法

## 渲染架构

`LiveRenderer` 采用**手动合成流水线**替代浏览器 CSS `z-index` 图层合成：

```
baseCanvas (CSS opacity: 0, 作为静态缓存)
     │
     ├─ 全量: copyBase()
     └─ 脏区: copyBaseRects(dirtyRects)
     │
     ▼
liveCanvas (唯一可见) ─── AOM 对象直接绘制在上层
     │
     ▼
  屏幕显示
```

`baseCanvas` 由 `BaseRenderer` 维护，视为 `liveCanvas` 的**预渲染缓存**。它的 `opacity: 0` CSS 属性使其不在屏幕上显示，但像素内容完整保留在 GPU 纹理中供 `drawImage` 读取。

LiveRenderer 通过 `monitor.baseRenderer.canvas` 访问 baseCanvas。

### 缓存时序保护

由于 base 和 live 的调度器是彼此独立的 rAF 调度器，`render()` 在拷贝 `baseCanvas` 前会检查 `monitor.baseRenderer._scheduler.framePending`，若有待处理帧则同步调用 `flush()`，确保读到最新的缓存状态。这替代了之前通过 `monitor.baseRenderScheduler` 的检查。

### 与 BaseRenderer 的数据依赖

- 构造时通过 Monitor 获取 baseCanvas：`monitor.baseRenderer.canvas`
- 时序同步通过 `baseRenderer._scheduler.framePending` 判断

### 三步流水线

每一帧 `render()` 按以下顺序执行：

1. **清理** — `clear()` 或 `clearDirtyRects()` 清除 `liveCanvas` 上的旧像素
2. **缓存回填** — `copyBase()` 或 `copyBaseRects()` 从 `baseCanvas` 拷贝静态层像素
3. **AOM 对象绘制** — 按 AOM 层顺序将当前应显示的对象渲染到 `liveCanvas`

三步流水线的设计原因：

- `drawImage` 使用 Canvas 2D 默认 `source-over` 合成模式，源像素 alpha=0 时不会覆盖目标像素；不先 `clear` 会导致残留的 AOM 对象像素层层叠加
- `baseCanvas` 只包含静态对象（AOM 对象已被 `BaseRenderer` 过滤），因此拷贝结果天然不含 AOM 对象
- AOM 对象最后绘制，确保它们始终在视觉顶层

### 缓存时序保护

由于 `baseRenderScheduler` 和 `renderScheduler` 是独立的 rAF 调度器，两者 flush 的执行顺序不确定。当对象进入 AOM 时：

- base 调度器需清除该对象在 `baseCanvas` 上的旧像素
- live 调度器需从 `baseCanvas` 拷贝时读到已清除的版本

若 live 调度器先于 base 调度器 flush，`copyBase()` 会读到残留的 AOM 对象像素，导致双重渲染。

`render()` 在拷贝 `baseCanvas` 前检查 `baseRenderScheduler.framePending`，若有待处理帧则同步调用 `baseScheduler.flush()`，确保读到最新缓存状态。

## 输入与输出

`LiveRenderer` 当前有三个核心输入：

- `monitor`：提供 `liveCanvas`、`baseCanvas`、2D context、`origin`、`zoom`、`baseRenderScheduler` 与世界到屏幕的矩形换算
- `activeObjectManager`：提供 AOM 对象实例、层顺序、同层非活动对象图与对象范围查询能力

它的输出只有一个：

- 在当前 `Monitor.liveCanvas` 上完成一次活动层重绘

## 绘制对象来源

当前实现不会单独维护另一份“待绘制对象列表”。它直接从 AOM 读取当前状态。

读取路径分三层：

### 按层读取对象

- 遍历 `layerOrder`
- 若该层是 active layer：先收集 `activeObjects` 中的活动对象，再收集 `inactiveGraph` 中按拓扑序排列的非活动对象
- 若该层是 inactive layer：该层 `activeObjects` 中保留下来的对象也按 inactive 语义处理，并与 `inactiveGraph` 一起参与绘制

这一点保证了当前活动层绘制顺序仍与 AOM 动态层语义一致，同时也保证了“仍在 AOM 中但已失活的层”不会从屏幕上消失。

### 处理同层 inactive 语义对象

当前实现中，`inactiveGraph` 中的对象不是简单按集合遍历，而是依赖 `layer.inactiveGraph.getTopologicalOrder()`。

这意味着：

- active layer 中，同层活动对象先绘制，同层 inactive 对象后绘制
- inactive layer 中，保留在 `activeObjects` 里的对象也会按 inactive 语义参与绘制
- 绘制顺序仍尽量复用 tier graph 的拓扑关系，而不是重新发明一套排序规则

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

对象屏幕矩形在换算完成后，还会叠加对象自身的 `getRenderPadding()` 留白。padding 从对象 `property` 里的宽度属性动态推导，而非对象类里的写死常量。当前至少覆盖了：

- `CircleObject` 的描边半宽
- `StrokeObject` 的圆角端点与默认描边半宽

## 渲染流水线

### render(dirtyRects)

`render()` 采用 **clear → copyBase → render** 三步流水线，有两种工作模式。

#### 无参调用（全量刷新）

1. 同步 `baseRenderScheduler`（若有待处理帧）
2. 收集所有 AOM 层 drawable
3. `clear()` 清空整张 `liveCanvas`
4. `copyBase()` 将整张 `baseCanvas` 拷贝到 `liveCanvas`（回填静态缓存）
5. 按顺序重绘全部 drawable
6. 更新 `previousDrawableEntries`

#### 显式传入 dirtyRects（局部刷新）

1. 同步 `baseRenderScheduler`（若有待处理帧）
2. 规范化脏区为 `RectangleRange`
3. `clearDirtyRects()` 只清理这些脏区
4. `copyBaseRects()` 只将脏区对应的 `baseCanvas` 区域拷贝到 `liveCanvas`
5. 只重绘与脏区相交的 drawable，并把补绘裁剪到这些脏区内部
6. 更新 `previousDrawableEntries`

### copyBase()

全量拷贝 `baseCanvas` 到 `liveCanvas`。在三步流水线中用作第二步，回填静态层。

- 调用 `ctx.drawImage(baseCanvas, 0, 0)`，重置 transform 后执行
- `baseCanvas` 或 context 不存在时静默返回

### copyBaseRects(rects)

脏区版本的缓存拷贝。在三步流水线中用作第二步，只回填脏区内的静态层像素。

- 对 `rects` 中每个 `RectangleRange` 调用 `ctx.drawImage(baseCanvas, left, top, width, height, left, top, width, height)`
- `baseCanvas`、context 或 `rects` 为空时静默返回
- 非 `RectangleRange` 的条目会被跳过

### 与 BaseRenderer 的缓存协作

`BaseRenderer` 负责维护 `baseCanvas` 缓存，其行为与 liveRenderer 配合：

- `BaseRenderer.render()` 过滤掉 AOM 中的对象，保证缓存中不含 AOM 对象
- 视口变化时先触发 `requestViewportBaseRender()` 更新缓存，再触发 `requestViewportLiveRender()` 使用缓存
- 对象进入/离开 AOM 时，`baseRenderScheduler` 和 `renderScheduler` 都被 invalidate，由 `framePending` 机制保证时序

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
- 因此当前协议同时依赖“显式旧几何快照”和“上一帧 drawable 缓存”两条来源

### captureObjectSnapshot(objects)

`captureObjectSnapshot()` 是当前旧几何快照协议的显式入口。

它的作用是：

- 在对象几何即将被修改前，先记录对象当前屏幕范围
- 若同一对象在一次 flush 前连续发生多次修改，则把多次旧范围合并成一个并集矩形

当前高频修改路径里，creator 工具已经会在几何变更前调用这条接口，再在变更后调用 `invalidateObjects()`。

此外，工具侧已经把同一协议沉淀到 `ObjectModifierTool` 基类，后续真实编辑工具只要复用该基类，就可以接入同样的刷新路径；当前仓库里还没有具体 modifier 子类落地到业务流程。

## 与 RenderScheduler 的关系

`LiveRenderer` 内部持有自己的 `_scheduler`。

当前关系是：

- `invalidateObjects()` 把脏区提交给 `this._scheduler.invalidate()`
- `invalidateViewport()` 提交整视口到调度器
- `RenderScheduler` 在合适时机调用 `LiveRenderer.flush(dirtyRects)`
- `flush()` 是 `render()` 的薄入口

这让"调度"和"绘制"边界保持清晰，且调度器生命周期完全由渲染器管理。

## 当前实现状态

### 已实现

- 按 `layerOrder` 读取对象、active layer 中“active 在前 / inactive 在后”的同层顺序、inactive layer 中 `activeObjects` 的 inactive 语义绘制、活动对象回退路径
- 世界矩形到屏幕矩形换算、对象级 `getRenderPadding()` 动态留白
- 显式 dirty rect 局部清理与局部重绘、局部补绘 clip
- 旧范围与新范围同时失效、显式旧几何快照协议
- **clear → copyBase → render 三步流水线**，替代浏览器 GPU 图层合成
- **`copyBase()` / `copyBaseRects()`** 全量与脏区缓存拷贝
- **`framePending` 时序保护**，防止 base/live 调度器竞争
- **base/live 均在 Worker 侧 OffscreenCanvas 上完成合成**，`liveBitmap` 经 `transferToImageBitmap()` 回传后在 UI 侧单 canvas 显示

### 已接入

- `LiveRenderer` 自管理 liveCanvas、`RenderScheduler`、脏区合并策略
- `ActiveObjectManager.add/choose/apply/discard` 已会主动触发 `LiveRenderer.invalidateObjects(...)`
- `stroke-creator` 与 `polygon-creator` 等高频几何修改路径已会在变更前记录快照、变更后请求活动层刷新
- `ObjectModifierTool` 已具备统一的几何变更包装钩子
- 同一批高频修改路径也会同步推动 ui 层刷新，使兼容选中框不会滞后

### 已兼容

- 无参 `render()` 保持全量清屏重绘语义
- 传入普通矩形对象时仍会被兼容处理
- `clear()` 和 `clearDirtyRects()` 保留为公开方法，供需要单独清理 `liveCanvas` 的场景使用

### 待完善

- 调度器侧的 dirty rect 合并策略已得到更完整的近邻/退化支持，但对象级 padding 仍需要覆盖更完整的对象族
- 真实 modifier 子类尚未接入这套快照协议
- `uiCanvas` 真实 overlay 语义与宿主边界仍需继续收敛

## 相关文档

- [monitor-document.md](../../orchestration/docs/monitor-document.md)
- [ui-renderer-document.md](./ui-renderer-document.md)
- [active-object-manager-document.md](../../orchestration/docs/active-object-manager-document.md)
- [tier-graph-document.md](../../orchestration/docs/tier-graph-document.md)
