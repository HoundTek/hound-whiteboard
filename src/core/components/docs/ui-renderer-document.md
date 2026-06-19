# UI 覆盖层渲染器文档

本文档提供 `UiRenderer` 的概述。

## 概述

`UiRenderer` 用于把视口相关、非对象实体、短生命周期的覆盖内容绘制到 `Monitor.uiCanvas`。

这类内容的共同点是：

- 它们通常不属于白板静态对象本体
- 它们经常跟随当前视口、输入态或临时交互态变化
- 它们更接近“正在交互的提示层”，而不是静态内容层或活动对象层

当前较典型的承载对象包括：

- 已选中对象的矩形框
- 对象选择工具的轨迹
- 控制杆
- 激光笔轨迹

## 边界说明

当前还不能完全确定 `uiCanvas` 最终应由 Core 管理还是由宿主 UI 管理。

因此，当前这份 `UiRenderer` 实现应理解为一层 **兼容实现**：

- 它先在 Core 内提供一个可工作的 `uiCanvas` 渲染链
- 它只承接 Core 当前已经知道、且确实需要跟随视口刷新的 overlay
- 它同时保留 provider 扩展口，避免现在就把所有 UI 语义钉死在 Core 中

这里“兼容层”的含义不是“最终 UI 设计”，而是“当前版本的兼容方案 / 适配层”：

- 它不是最终的 UI 系统主责方
- 它只是让 Core 侧暂时能兼容地渲染一部分 UI overlay
- 它优先服务当前已有的 Core 状态和需求，而不是提前定义未来全部 overlay 协议

如果后续宿主 UI 已经拥有更稳定的 overlay 系统，这层兼容实现可以继续缩薄，甚至整体上移。

## 当前职责

当前 `UiRenderer` 负责三件事：

- 从已注册 provider 收集兼容 overlay
- 把 overlay 统一规整到屏幕矩形语义上
- 在 `uiCanvas` 上执行局部清理、裁剪和补绘

其中默认接入的一类兼容 overlay 是：

- chooser / modifier 工具主动声明的兼容选择框

也就是说，当前兼容层不会再简单使用“对象在 AOM 中”作为选择框出现条件。

当前默认规则是：

- 若当前工具是对象选择工具，则 chooser tool provider 会声明当前上下文对象的选择框
- 若当前工具是对象修改工具，则 modifier tool provider 会声明当前上下文对象的选择框
- 对于多对象场景，除了每个对象自己的矩形框，还会额外绘制这些对象矩形的最小外接大矩形

当前默认样式也有一条固定约定：

- 每个对象自己的选择框使用实线
- 多对象组合大矩形继续使用虚线

这并不意味着 chooser / modifier 节点 state 就是最终 UI overlay 协议。当前只是让 chooser / modifier 工具先复用自己已有的上下文状态，把它们主动声明成 provider 条目，先把 `uiCanvas` 链路兼容起来。

## Overlay Provider 扩展口

为了兼容未来的 chooser 轨迹、控制杆、激光笔等 UI 覆盖层，`UiRenderer` 当前提供 provider 注册口：

- `registerOverlayProvider(provider)`
- `unregisterOverlayProvider(provider)`

provider 的职责是：

- 在 flush 前根据当前 `monitor`、`activeObjectManager` 和外部状态返回 overlay 条目
- 条目可直接给出 `screenRect` 或 `worldRect`
- 条目可通过 `draw(context, runtime)` 自定义绘制逻辑

当前这条扩展口更像一个兼容桥，而不是最终 UI 协议。

## 与 Monitor 的关系

`UiRenderer` 本身不管理画布尺寸，也不决定何时 flush。

当前分工是：

- `Monitor` 持有 `uiCanvas`
- `Monitor.uiRenderScheduler` 负责合并 ui 层脏区并调度 flush
- `UiRenderer` 负责实际清理与绘制

当前 `Monitor` 会在这些时机推动 ui 层刷新：

- 视口平移或缩放
- 渲染层尺寸变化
- 显式 `flushViewportRender()`
- 注册或注销 overlay provider

## 与 AOM / 工具链的关系

当前 Core 里，ui 覆盖层和活动对象链路已经接上：

- `ActiveObjectManager.requestLiveRender(...)` 在请求 live 层刷新时，也会同步请求 ui 层刷新
- creator 工具在高频几何修改后，除了请求 `LiveRenderer.invalidateObjects(...)`，也会请求 ui 层刷新
- `ObjectModifierTool` 基类在高频几何修改后，也会同步请求 ui 层刷新

但这里要区分“谁推动刷新”和“谁决定显示内容”：

- `AOM`、creator、modifier 当前都可以推动 ui 层重绘
- 真正决定当前默认选择框是否出现的，是 chooser / modifier 工具当前是否声明了对应 overlay
- chooser / modifier 工具当前仍主要从自己的节点上下文里取对象集合
- 因此，“对象在 AOM 中”只说明它处于动态图，不再自动等于“应该显示选择框”

这样做的原因是：

- 选中框之类的 overlay 会跟随对象位置和几何变化移动
- 如果 ui 层只响应 `add/choose/apply/discard` 这些低频状态点，拖拽和控制点修改时就会滞后

## 当前实现状态

- 已实现：`Monitor.uiRenderScheduler`、`UiRenderer.flush(dirtyRects)`、基于 chooser / modifier tool provider 的兼容选择框、对象多选组合大矩形、自定义 overlay provider 注册口。
- 已接入：视口变化、渲染层 resize、AOM 活动对象刷新、creator/modifier 高频几何修改后的 ui 层补绘。
- 已兼容：provider 条目既可给出 `screenRect/worldRect`，也可直接提供 `draw(...)` 回调。
- 待完善：对象选择轨迹、控制杆、激光笔等真实 overlay 语义仍未在 Core 中定型；ui 层最终归属 Core 还是宿主 UI，当前仍未最终定案。

## 相关文档

- [monitor-document.md](./monitor-document.md)
- [components-document.md](./components-document.md)
- [active-object-manager-document.md](./active-object-manager-document.md)
- [live-renderer-document.md](./live-renderer-document.md)