# Hound Whiteboard 绘制性能优化方案：避免整屏重绘

## 概述

本文档给出 Hound Whiteboard 当前渲染路径下的局部重绘优化方案，目标是减少高频输入期间的整屏刷新，并保持现有活动对象管理与层叠图语义不变。

这里的核心判断是：

- 静态对象仍由区块级静态结构负责持久化与层关系保存。
- 交互中的对象仍由 ActiveObjectManager 管理其动态层关系。
- 渲染优化只改变“怎么画”，不改变“对象最终属于哪一区块、在哪一层”。

因此，这不是一次数据结构重写，而是一次渲染执行路径重构。

## 当前实现可利用的基础

当前代码里已经有几块可以直接复用的基础能力。

### 视口与输入上下文已经集中在 Monitor

- src/core/components/board.js 中，Board.createMonitor(rootElement, options, monitorId) 会在传入根节点下创建 monitor canvas。
- src/core/components/monitor.js 中，Monitor 已经统一管理：
  - canvas 尺寸
  - origin
  - zoom
  - screenToWorld()
  - screenToChunk()
- 工具链当前拿到的 deviceContext.monitor 也是以 Monitor 为入口。

这说明“渲染层挂在哪里”这个问题，答案应优先落在 Monitor，而不是 Chunk 或工具层。

### 活动对象已经和静态区块结构分离

- src/core/components/active-object-manager.js 中，活动对象由 ActiveObjectManager 统一维护。
- add(objects) 用于把尚未写回静态区块结构的新对象加入动态图。
- choose(startFrom) 用于从静态图中提取活动子图并分层。
- apply(objects) 才负责把活动对象重新提交回区块对象管理器与静态层关系。

这意味着当前架构已经存在“静态内容”和“交互态内容”的天然边界。

### 模板层已经有独立前景容器

- src/templates/whiteboard.html 里当前存在：
  - app-background-layer
  - app-texture-layer
  - app-foreground-layer
- 当前 monitor canvas 直接挂在 app-foreground-layer 下。

这为后续将单 canvas 扩展为多 canvas 叠层提供了现成挂载点。

## 当前瓶颈

当前整屏重绘问题，本质上不是对象模型不够，而是高频输入和同步绘制耦合过深。

典型表现包括：

- pointermove 或 mousemove 期间，每次事件都直接触发绘制。
- 交互态对象和静态对象共用同一显示层时，局部变化会放大成全画面刷新。
- 活动对象虽然在语义上已被 AOM 单独管理，但渲染上还没有形成独立的 live 层。

因此，最先要切开的不是算法细节，而是渲染职责边界。

## liveCanvas 最适合挂在哪一层

### 结论

liveCanvas 最适合挂在 Monitor 这一层，作为 Monitor 视口内部的同级渲染层，而不是挂在：

- Chunk 层
- ActiveObjectManager 层
- 单个工具实例层

### 原因

#### 不应挂在 Chunk 层

Chunk 和 ChunkObjectManager 更适合表达静态归属、覆盖区块索引、区块内对象关系。

如果把 liveCanvas 绑定到 Chunk：

- 跨区块对象会带来额外的画布拆分与同步问题。
- Monitor 的 origin 和 zoom 变换需要重复分发到各区块画布。
- 交互对象本来是“全板活动态”，会被错误地下沉到“单区块局部态”。

这和 AOM 的全局活动对象模型不一致。

#### 不应挂在 AOM 层

AOM 负责的是：

- 活动对象实例索引
- 动态层顺序
- 跨区块拾取
- 提交回静态图

它不负责：

- 视口坐标变换
- DPR
- DOM/canvas 生命周期
- 单个 Monitor 的显示策略

如果把 liveCanvas 直接挂到 AOM，数据模型会反向侵入渲染基础设施。

#### 最适合挂在 Monitor 层

Monitor 当前已经掌握局部重绘所需的全部视口信息：

- 世界坐标到屏幕坐标的映射
- 当前缩放比例
- 当前视口原点
- 当前输入上下文

因此更合理的做法是：

- 由 Board.createMonitor() 创建一个 monitor 容器。
- 在该容器内创建 baseCanvas、liveCanvas、uiCanvas。
- 由 Monitor 或其下属渲染器统一维护三层 canvas 的尺寸、DPR 和坐标系。

这会让活动对象语义继续留在 AOM，而把绘制职责留在视口层。

## 目标渲染分层

建议把当前单 monitor canvas 改成如下结构：

```text
app-foreground-layer
└── monitor-root
    ├── baseCanvas
    ├── liveCanvas
    └── uiCanvas
```

各层职责如下：

- baseCanvas
  - 展示已提交到区块静态结构的对象
  - 低频刷新
  - 允许后续扩展为按区块或按块缓存
- liveCanvas
  - 展示当前活动对象
  - 包含正在绘制、拖拽、修改控制点、尚未 apply 的对象
  - 高频刷新，但只做局部清理和重绘
- uiCanvas
  - 展示选框、控制点、辅助线、hover 高亮
  - 与对象本体绘制分离，避免污染 liveCanvas

## 核心方案

### 1. 先分层，再谈脏区

第一优先级不是一开始就做复杂 dirty rect，而是先让静态层与活动层分离。

原因很直接：

- 只要交互态仍和静态对象共画在一个 canvas 上，就很难真正避免大范围重绘。
- AOM 已经提供了活动对象集合和动态层次，这一层天然就是 liveCanvas 的数据来源。

因此，第一阶段先把“活动对象只画到 liveCanvas”跑通。

### 2. 渲染调度统一到 requestAnimationFrame

不要在 pointermove/mousemove 中直接 render。

改为：

- 输入事件只更新对象状态。
- 输入事件只登记脏区 invalidate(rect)。
- 若当前没有待渲染帧，则 requestAnimationFrame(flush)。
- flush 中统一合并脏区并执行一次实际重绘。

伪代码如下：

```js
class RenderScheduler {
  framePending = false;
  dirtyRects = [];

  invalidate(rect) {
    if (rect) this.dirtyRects.push(rect);
    if (this.framePending) return;
    this.framePending = true;
    requestAnimationFrame(() => this.flush());
  }

  flush() {
    this.framePending = false;
    const mergedRects = mergeDirtyRects(this.dirtyRects);
    this.dirtyRects.length = 0;

    for (const rect of mergedRects) {
      clearLiveRect(rect);
      renderLiveObjectsIntersecting(rect);
      renderUiOverlayIntersecting(rect);
    }
  }
}
```

这一步的意义是把“输入频率”和“实际绘制频率”解耦。

### 3. 脏矩形只在 liveCanvas 和 uiCanvas 先落地

dirty rect 的第一落点应当是 liveCanvas，而不是一开始就改 baseCanvas。

原因有三点：

- liveCanvas 的对象量通常远少于整板静态对象。
- liveCanvas 的内容天然是短生命周期，可直接清空局部区域再重画。
- baseCanvas 一旦涉及静态对象遮挡、跨区块内容与缓存策略，复杂度会快速上升。

建议 dirty rect 的基本计算方式为：

- oldRect = 对象变化前世界包围盒映射到屏幕后的矩形
- newRect = 对象变化后世界包围盒映射到屏幕后的矩形
- dirtyRect = union(oldRect, newRect).inflate(padding)

其中 padding 至少覆盖：

- 描边宽度
- 抗锯齿边缘
- 端点 lineCap
- 控制点半径
- 阴影或发光效果

### 4. 利用 AOM 作为 liveCanvas 的对象源

这里不建议新建一套“交互中对象列表”。

直接复用 AOM 当前已有的对象来源：

- activeObjectIndex 提供对象实例
- layerOrder 与 onLayer 提供动态层顺序
- activeObjects 提供当前活动对象集合

也就是说：

- AOM 负责回答“当前哪些对象应该在 liveCanvas 上显示，以及它们的相对顺序是什么”。
- Monitor 渲染层负责回答“这些对象当前怎样画到屏幕上”。

两者之间只需要一个薄适配层，而不需要重新设计核心数据结构。

### 5. 候选对象筛选不能只看当前活动对象

局部重绘时，不能简单理解为“liveCanvas 只画活动对象，所以 dirtyRect 里也只重画活动对象”。

更准确的做法是：

- liveCanvas 主体只画活动对象。
- 如果存在依赖邻层非活动对象来表达遮挡关系的视觉需求，则需要额外建立最小补绘集合。

这是因为 tier graph 的语义不是纯几何排序，而是“几何相交 + 层次顺序”共同决定显示关系。

建议分两阶段处理：

- 第一阶段：liveCanvas 仅绘制活动对象，静态对象仍完全留在 baseCanvas，不尝试在 live 层复现复杂遮挡。
- 第二阶段：若验证发现活动对象与静态对象局部交叠时有明显视觉错误，再引入“邻层静态补绘”策略。

这样可以先拿到性能收益，再决定是否增加复杂度。

## 基于 AOM 的局部重绘落地设计草案

下面给出一个和当前架构对齐的最小可落地设计。

### 设计目标

- 不修改 AOM 的语义边界。
- 不修改 apply(objects) 的最终提交职责。
- 不要求 ChunkObjectManager 立刻支持多画布。
- 先让高频交互脱离整屏重绘。

### 模块拆分

建议新增或调整以下模块职责。

#### Board

- 继续负责 createMonitor()。
- 不直接负责局部重绘算法。
- 将单 canvas 创建逻辑升级为 monitor 容器创建逻辑。

#### Monitor

- 继续负责 origin、zoom、screenToWorld、screenToChunk。
- 新增对多 canvas 的统一管理。
- 对外暴露：
  - baseCanvas/baseContext
  - liveCanvas/liveContext
  - uiCanvas/uiContext
  - worldRectToScreenRect()
  - resizeRenderLayers()

#### RenderScheduler

- 挂在单个 Monitor 下。
- 管理 dirtyRects、RAF 调度、脏区合并。
- 不关心对象语义来源。

#### LiveRenderer

- 输入：Monitor + ActiveObjectManager。
- 输出：把当前活动对象按动态层顺序渲染到 liveCanvas。
- 核心职责：
  - 从 AOM 读取当前活动对象实例
  - 依据 layerOrder 排序
  - 计算对象屏幕包围盒
  - 按 dirtyRect 选择需要重绘的对象

#### BaseRenderer

- 继续负责静态对象绘制。
- 第一阶段仍可保留较粗的刷新策略。
- 只在 apply(objects)、分区块切换、缩放平移稳定点等低频时机更新。

## 当前代码进度

截至当前版本，渲染链路已经先落下了最小骨架：

- `Board.createMonitor()` 已创建 monitor-root、`baseCanvas`、`liveCanvas`、`uiCanvas`。
- `Monitor` 已持有多层画布引用，并保留 `monitor.canvas -> liveCanvas` 的兼容入口。
- `BaseRenderer` 已挂在 `Monitor` 下，可把当前已加载区块的 `staticGraph` 合并成 monitor 级全局静态图，并按全局拓扑序把静态对象重绘到 `baseCanvas`。
- `BaseRenderer` 已支持显式 dirty rect 驱动的局部清理与局部重绘。
- `BaseRenderer` 的局部重绘不会退化成“按脏区命中的对象临时排序”，而是先沿用全局静态图拓扑序，再过滤命中脏区的对象。
- `Monitor.worldRectToScreenRect()` 已补齐，活动对象现在可以直接从世界范围换算到当前视口屏幕范围。
- `Monitor` 已持有 `baseRenderScheduler`，并会在区块缓冲区变化、`origin/zoom` 变化时自动请求 base 层刷新；视口变化时会同时覆盖旧视口与新视口下的可见区块。
- `RenderScheduler` 已挂在 `Monitor` 下，支持多次 invalidate 合并到单次 flush，并把 dirty rect 透传给 `LiveRenderer.flush(...)`。
- `LiveRenderer` 已挂在 `Monitor` 下，可按 `ActiveObjectManager.layerOrder` 顺序读取活动对象并重绘到 `liveCanvas`。
- `LiveRenderer` 已支持显式 dirty rect 驱动的局部清理与局部重绘。
- `LiveRenderer.invalidateObjects(objects)` 已支持同时失效对象上一帧范围与当前范围，避免对象移动后旧位置残影。
- `LiveRenderer` 已接入对象级 `getRenderPadding()`，当前至少覆盖 `CircleObject`、`StrokeObject`、`TextObject` 这几类高频对象。
- `LiveRenderer.captureObjectSnapshot(objects)` 已落地，creator 高频几何修改路径现在会在变更前记录旧几何、变更后请求活动层刷新。
- `ObjectModifierTool` 已补齐统一的 `beforeGeometryMutation / afterGeometryMutation / withGeometryMutation` 钩子，为后续编辑工具预留同一套快照协议入口。
- `ActiveObjectManager.add/choose/apply/discard` 已会主动通知各 `Monitor.liveRenderer` 发起活动层刷新。
- `ActiveObjectManager.apply(objects)` 已会在静态结构写回后主动触发对象旧覆盖区块与新覆盖区块的并集刷新。

当前还没有完成的部分是：

- `uiCanvas` 的专用渲染器
- `baseCanvas` 现在已经有了第一版 dirty rect 与自动刷新链路，`apply()` 与视口变化也已收窄到区块级失效；但还没有推进到真正的区块补绘和更细粒度缓存
- dirty rect 合并、裁剪与 padding 策略仍较基础，尚未针对复杂笔迹和大范围编辑做更细优化
- 对象几何变化虽然已经能覆盖前后两帧范围，但还没有进一步抽象成更稳定的“旧几何快照 -> 新几何快照”更新协议
- 旧几何快照协议已经有了第一版，creator 高频修改路径已接入，modifier 侧也已沉淀出统一基类钩子；但还没有具体编辑工具子类真正走通这条链路

### 设计约束

- `LiveRenderer.render()` 无参调用仍保持全量清屏重绘。
- 只有在调度器或调用方显式传入 dirty rect 时，`LiveRenderer` 才进入局部清理与局部重绘路径。
- 这样做是为了保留现有调用方语义，避免把原本依赖“整层重画”的路径静默改成“局部补画”后引入漏清理问题。
- `invalidateObjects(objects)` 不再只看对象当前位置，而是同时把上一帧范围和当前范围都送入调度器。
- 这样做是为了保证拖拽、平移、控制点修改这类位移型操作不会在 liveCanvas 上留下旧像素残影。
- 对象在几何变更前可以通过 `captureObjectSnapshot(objects)` 显式记录旧范围。
- 这样做是为了让对象即使尚未经历上一帧 render，也能在下一次失效时保住变更前的屏幕脏区。
- 对象的屏幕脏区不会只取几何包围盒，还会叠加对象级 `getRenderPadding()`。
- 这样做是为了把描边、圆角端点、文本框边框这类超出主判定范围的可见像素也纳入局部清理范围。

### 关键流程

#### 流程一：创建新对象

1. 工具创建对象实例。
2. 调用 AOM.add(objects)，对象进入活动层。
3. 工具在 move 期间只更新对象几何。
4. 每次几何变化先记录旧几何快照，再调用 `liveRenderer.invalidateObjects(objects)` 请求局部刷新。
5. `RenderScheduler` 汇总脏区后，`LiveRenderer` 在下一帧重绘该对象局部区域。
6. 抬笔后调用 AOM.apply(objects)。
7. BaseRenderer 在提交完成后按对象旧覆盖区块与新覆盖区块的并集刷新；区块缓冲区变化和视口变化时也按区块矩形增量刷新。
8. liveCanvas 清除对应对象的残留内容。

#### 流程二：选择并拖拽已有对象

1. 通过 AOM.choose(startFrom) 生成活动层。
2. 被选对象从语义上转入活动态。
3. 拖拽期间对象只在 liveCanvas 上刷新。
4. baseCanvas 保留原已提交内容，直到 apply(objects) 后再统一更新。
5. 结束交互后，重新提交静态图关系与覆盖区块索引。

#### 流程三：仅 UI 变化

1. hover、选框、控制点变化只进入 uiCanvas。
2. 不触发 baseCanvas 重绘。
3. 若对象本体不变，也不触发 liveCanvas 重绘。

### 推荐的接口走向

建议新增以下类型的方法或等价接口：

```js
monitor.ensureRenderLayers();
monitor.resizeRenderLayers(width, height, dpr);
monitor.worldRectToScreenRect(range);

renderScheduler.invalidate(rect);
renderScheduler.flush();

liveRenderer.renderDirty(rects);
liveRenderer.collectActiveDrawables();

baseRenderer.renderChunks(chunkIds);
baseRenderer.renderRegion(rect);
```

这些接口的重点不是名字本身，而是边界：

- Monitor 提供视口换算与 canvas 容器。
- Scheduler 提供节流与脏区调度。
- Renderer 提供实际绘制。
- AOM 继续只提供活动对象与层次信息。

## 实施顺序建议

### 第一阶段：最小收益闭环

1. 改造 src/templates/whiteboard.html，对 app-foreground-layer 内部引入 monitor-root 容器。
2. 改造 Board.createMonitor()，让它创建多 canvas 结构而不是单 canvas。
3. 扩展 Monitor，使其统一维护 base/live/ui 三层 canvas。
4. 新增 RenderScheduler，并先只驱动 liveCanvas 与 uiCanvas。
5. 将正在绘制或拖拽的对象改为从 AOM 读取并绘制到 liveCanvas。

这一阶段先不要求 baseCanvas 做精细 dirty rect。

### 第二阶段：补齐精细局部刷新

1. 为常见对象补齐稳定的 world range 到 screen rect 计算。
2. 为笔迹、折线、多边形补齐 padding 策略。
3. 优化 dirty rect 合并策略，避免过粗退化为全屏刷新。
4. 评估是否需要邻层静态补绘。

### 第三阶段：静态层进一步优化

1. 为 baseCanvas 引入按区块、按块或缓存层刷新。
2. 评估 OffscreenCanvas 或 Worker。
3. 评估对象空间索引以加速相交候选筛选。

## 验收标准

- 连续快速书写时，move 阶段不再触发整屏刷新。
- 拖拽活动对象时，主要刷新发生在 liveCanvas 而不是 baseCanvas。
- apply(objects) 后静态结果与当前层叠图语义一致。
- 无明显残影、漏绘、错层。
- 缩放、平移、跨区块操作下三层 canvas 坐标系保持一致。

## 风险与注意事项

### 不能把渲染优化误做成状态模型重构

局部重绘的目标是减少绘制成本，不是替换 AOM 或区块级静态结构。

### 多层 canvas 必须统一坐标系与 DPR

否则容易出现：

- 指针命中偏移
- UI 覆盖层错位
- liveCanvas 与 baseCanvas 对不齐

### apply(objects) 仍然是静态一致性的唯一提交点

不要在 move 阶段把半成品反复写回静态图，否则会破坏当前架构已经建立的边界。

### 跨区块对象要优先按世界坐标思考脏区

先在世界坐标中算范围，再映射到当前 Monitor 屏幕坐标。不要把 dirty rect 直接绑死在单区块局部坐标系里。

## 一句话结论

对当前项目来说，最稳妥的路径不是“立刻全面改成复杂 dirty rect 引擎”，而是：

- 先把 Monitor 扩展成多 canvas 视口。
- 再把 AOM 活动对象渲染迁移到 liveCanvas。
- 最后在 liveCanvas 上做 RAF + dirty rect。

这样既顺着现有 ActiveObjectManager 和层叠图设计往下走，也能在最小改动下优先拿到性能收益。
