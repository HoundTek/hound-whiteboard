# 静态层渲染器文档

本文档提供 `BaseRenderer` 的概述。

静态层渲染器用于把 `Monitor.chunkBlockLoader` 当前已加载区块中的静态对象，按“已加载区块合并后的全局静态图拓扑序”绘制到 `Monitor.baseCanvas`。

它和 `LiveRenderer` 的边界不同：`LiveRenderer` 负责活动对象，`BaseRenderer` 负责已经提交回白板静态结构的对象。

## 模块定位

`BaseRenderer` 当前处在一条更偏“提交后显示”的链路中：

- `ActiveObjectManager.apply(objects)` 负责把活动对象写回区块静态结构
- `ChunkObjectManager` 负责维护静态对象映射与 `staticGraph`
- `Monitor.chunkBlockLoader` 负责回答“当前视口缓冲区里有哪些区块”
- `BaseRenderer` 负责回答“这些已加载区块里的静态对象，如何画到 `baseCanvas` 上”

## 当前职责

当前 `BaseRenderer` 已经分成两条路径。

当前行为是：

1. 从 `chunkBlockLoader.getLoadedChunks()` 读取当前已加载区块
2. 把这些区块里的 `staticGraph` 合并成一个 monitor 级全局静态图
3. 对合并后的全局静态图执行一次拓扑排序
4. 通过 `ActiveObjectManager.findBoardObjectInstance(...)` 回查对象实例，并按对象 id 去重
5. 为对象计算屏幕包围盒
6. 无参调用时清空整张 `baseCanvas` 并重绘全部静态对象
7. 显式传入 dirty rect 时，只清理这些脏区，并只重绘命中脏区的静态对象

这里有一个实现约束：

- `dirty rect` 只负责筛掉“不需要重绘的对象”，不改变绘制顺序的来源
- 静态对象的先后顺序仍然来自“已加载区块合并后的全局静态图拓扑序”

也就是说，局部重绘不是“先按脏区挑对象，再临时排序”，而是“先得到全局顺序，再过滤出命中脏区的对象”。

这意味着当前已经不只是“整层静态重绘”，而是有了第一版静态层增量刷新能力。

不过它仍暂不承担：

- 区块级脏区裁剪
- 区块增量补绘

## 当前触发时机

当前已接入三类触发时机：

- `ActiveObjectManager.apply(objects)` 完成静态结构写回后，会主动请求“对象旧覆盖区块 + 新覆盖区块”对应的静态层刷新
- `ChunkBlockLoader` 缓冲区更新后，`Monitor` 会把“旧区块 + 新区块”的屏幕矩形送入 base 层调度器
- `Monitor.origin / zoom` 变化后，会主动请求“旧视口可见区块 + 新视口可见区块”的静态层刷新

其中第一条仍是刻意保守的策略。

原因是 `apply()` 属于低频、语义明确的提交点；对象提交回静态结构后，至少要同时覆盖它变更前后的静态落点，所以这里当前按“旧覆盖区块 + 新覆盖区块”的并集失效，而不是更细的对象级静态脏区。

而后两条则已经开始走脏区驱动：

- 区块缓冲区变化时，按区块矩形失效
- 视口变化时，同时按旧视口坐标系下的旧区块矩形和新视口坐标系下的新区块矩形失效

## 当前实现状态

- 已实现：按已加载区块收集静态对象、按已加载区块合并后的全局静态图拓扑序绘制、跨区块重复对象去重、显式 dirty rect 局部清理与局部重绘。
- 已接入：`Monitor` 已持有 `baseRenderer` 与专用 `baseRenderScheduler`；`ActiveObjectManager.apply(objects)` 已会按旧/新区块并集触发 base 层刷新；区块缓冲区变化与视口变化也会自动触发 base 层刷新。
- 待完善：按对象真实像素进一步细化静态层脏区、按区块裁剪重绘、区块增量补绘、缩放平移下更细粒度的静态层缓存策略。

## 相关文档

- [monitor-document.md](./monitor-document.md)
- [live-renderer-document.md](./live-renderer-document.md)
- [active-object-manager-document.md](./active-object-manager-document.md)