# 静态层渲染器文档

本文档提供 `BaseRenderer` 的概述。

静态层渲染器用于把 `Monitor.chunkBlockLoader` 当前已加载区块中的静态对象，按“已加载区块合并后的全局静态图拓扑序”绘制到 `Monitor.baseCanvas`。

它和 `LiveRenderer` 的边界不同：`LiveRenderer` 负责绘制当前仍在 AOM 中的对象，`BaseRenderer` 负责绘制已经脱离 AOM、稳定存在于白板静态结构中的对象。

## 模块定位

`BaseRenderer` 当前处在一条更偏“提交后显示”的链路中：

- `ActiveObjectManager.apply(objects)` 负责把活动对象写回区块静态结构
- `ChunkObjectManager` 负责维护静态图与对象覆盖区块索引，`Board` 负责持有对象实例
- `Monitor.chunkBlockLoader` 负责回答“当前视口缓冲区里有哪些区块”
- `BaseRenderer` 负责回答“这些已加载区块里的静态对象，如何画到 `baseCanvas` 上”

## 当前职责

当前 `BaseRenderer` 已经分成两条路径。

当前行为是：

1. 从 `chunkBlockLoader.getLoadedChunks()` 读取当前已加载区块
2. 把这些区块里的 `staticGraph` 合并成一个 monitor 级全局静态图
3. 对合并后的全局静态图执行一次拓扑排序
4. 通过 `ActiveObjectManager.findBoardObjectInstance(...)` 回查对象实例，并按对象 id 去重
5. 为对象计算屏幕包围盒，并叠加对象自身按 `property` 动态推导的 `getRenderPadding()` 留白
6. 无参调用时清空整张 `baseCanvas` 并重绘全部静态对象
7. 显式传入 dirty rect 时，只清理这些脏区，并只重绘命中脏区的静态对象

这里有一个实现约束：

- `dirty rect` 只负责筛掉“不需要重绘的对象”，不改变绘制顺序的来源
- 静态对象的先后顺序仍然来自“已加载区块合并后的全局静态图拓扑序”
- 对象命中判断使用的是“屏幕包围盒 + `getRenderPadding()`”后的结果，避免粗描边、端点和文本留白在静态层局部重绘时被裁掉
- 显式 dirty rect 模式下，当前实现会先清理脏区，再对补绘建立同一组屏幕脏区 clip，避免对象在未清理区域被重复叠画

也就是说，局部重绘不是“先按脏区挑对象，再临时排序”，而是“先得到全局顺序，再过滤出命中脏区的对象”。

这意味着当前已经不只是“整层静态重绘”，而是有了第一版静态层增量刷新能力。

不过它仍暂不承担：

- 区块级脏区裁剪
- 区块增量补绘

## 当前触发时机

当前已接入三类触发时机：

- `ActiveObjectManager.apply(objects)` 完成静态结构写回后，会优先请求“对象进入活动层前的旧世界范围 + 提交后的新世界范围”对应的静态层刷新；若本次提交还改动了静态层上下关系，则会把受影响的邻接静态对象一起纳入对象级失效；若当前 monitor 无法做对象级失效，再回退到“旧覆盖区块 + 新覆盖区块”并集
- `ChunkBlockLoader` 缓冲区更新后，`Monitor` 会把“旧区块 + 新区块”的屏幕矩形送入 base 层调度器
- `Monitor.origin / zoom` 变化后，会主动请求“旧视口可见区块 + 新视口可见区块”的静态层刷新

其中第一条现在已经进入对象级静态脏区第一版。

原因是 `apply()` 属于低频、语义明确的提交点；对象提交回静态结构后，至少要同时覆盖它进入活动层前的旧静态像素和提交后的新静态像素，所以这里现在优先按对象旧/新范围失效，只在缺少对象级能力时才退回区块并集。

`BaseRenderer.invalidateObjects(...)` 不再在提交给 `baseRenderScheduler` 前做批内脏区合并，而是把每个对象的当前屏幕范围和旧世界快照范围直接提交给调度器。由调度器统一在 `flush()` 时执行合并与 canonical rect 塌缩。

而后两条则已经开始走脏区驱动：

- 区块缓冲区变化时，按区块矩形失效
- 视口变化时，同时按旧视口坐标系下的旧区块矩形和新视口坐标系下的新区块矩形失效

## 当前实现状态

- 已实现：按已加载区块收集静态对象、按已加载区块合并后的全局静态图拓扑序绘制、跨区块重复对象去重、显式 dirty rect 局部清理与局部重绘、局部补绘 clip、对象级 `getRenderPadding()` 动态留白、对象级静态失效。
- 已接入：`Monitor` 已持有 `baseRenderer` 与专用 `baseRenderScheduler`；`ActiveObjectManager.apply(objects)` 已会优先按对象旧/新范围触发 base 层刷新，并在必要时回退到旧/新区块并集；区块缓冲区变化与视口变化也会自动触发 base 层刷新。
- 对象级失效的屏幕脏区不再在 `invalidateObjects` 中预合并，而是原样提交给调度器，由 `RenderScheduler.flush()` 统一合并与 canonical rect 塌缩，避免预合并时的区域丢失。
- 待完善：按对象真实像素进一步细化静态层脏区、按区块裁剪重绘、区块增量补绘、缩放平移下更细粒度的静态层缓存策略。

## 相关文档

- [monitor-document.md](./monitor-document.md)
- [live-renderer-document.md](./live-renderer-document.md)
- [active-object-manager-document.md](./active-object-manager-document.md)
