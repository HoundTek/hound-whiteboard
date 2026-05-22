# 渲染调度器文档

本文档提供 `RenderScheduler` 的概述。

渲染调度器用于把多次连续的失效请求合并到一次 flush 中执行。它不关心对象语义，也不直接操作任何画布。它只负责“何时把一批脏区交给渲染器处理”。

## 模块定位

`RenderScheduler` 当前是 `Monitor` 侧的通用调度层。

它的边界是：

- 不决定某个对象是否需要刷新
- 不计算对象世界范围
- 不负责真正绘制对象
- 只管理 dirty rect 的积累、调度与 flush 触发

在当前渲染链路中，它位于 `Monitor` 和 `LiveRenderer` 之间。

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
- 默认行为：原样返回输入数组

当前默认实现还没有做真正的几何合并，这符合当前阶段“先把调度边界跑通，再做复杂优化”的策略。

### flushHandler

- 类型：flush 回调
- 默认行为：空函数

在当前 Monitor 链路中，`flushHandler` 最终会指向 `LiveRenderer.flush(dirtyRects)`。

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

## 与 Monitor / LiveRenderer 的关系

当前接入方式是：

- `Monitor` 持有一个 `RenderScheduler`
- `Monitor` 在构造时把 `flushHandler` 绑定到 `liveRenderer.flush(dirtyRects)`
- `LiveRenderer.invalidateObjects(...)` 或其它调用方通过 `monitor.renderScheduler.invalidate(rect)` 提交脏区

这里的职责边界很明确：

- `RenderScheduler` 决定何时 flush
- `LiveRenderer` 决定 flush 时画什么
- `Monitor` 决定这套调度归属哪个视口实例

## 当前实现状态

- 已实现：多次 `invalidate(...)` 合并到单次调度、可替换的 `scheduleFrame`、可替换的 `mergeDirtyRects`、可替换的 `flushHandler`、手动 `flush()` 与 `clear()`。
- 已验证：同一帧周期内的多次失效请求只会触发一次调度；`flush()` 会先走 `mergeDirtyRects(...)` 再调用处理器。
- 已接入：`Monitor` 已使用 `RenderScheduler` 驱动 `LiveRenderer.flush(dirtyRects)`。
- 待完善：默认的 `mergeDirtyRects` 仍是原样返回；还没有针对矩形并集、裁剪和过大脏区退化策略做统一实现。

## 相关文档

- [monitor-document.md](./monitor-document.md)
- [live-renderer-document.md](./live-renderer-document.md)
