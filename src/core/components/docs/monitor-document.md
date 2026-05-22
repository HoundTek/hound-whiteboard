# 显示器组件文档

本文档提供白板中的重要组件——显示器组件（Monitor）的概述。

## 显示器组件

显示器组件是设备树的挂载点。它本身不承担普通设备的输入语义，而是负责承载视口画布、维护设备子树，并把 Core 的结果组织成可显示的 UI。

当前实现里，Monitor 不再只对应单个 `canvas`，而是对应一个 monitor-root 容器。这个容器内至少有三层渲染画布：

- `baseCanvas`：静态对象层
- `liveCanvas`：活动对象层
- `uiCanvas`：交互覆盖层

注：现阶段仍输出 DOM 结构与 `HTMLCanvasElement`，未来可能改为 `ReactElement`。

为兼容旧代码，`monitor.canvas` 当前仍指向 `liveCanvas`。

## 渲染职责

Monitor 当前不仅是输入与设备树边界，也是视口层渲染边界。

它会持有并协调：

- 多层 canvas 的尺寸同步
- 视口原点 `origin`
- 缩放比例 `zoom`
- `BaseRenderer`
- `RenderScheduler`
- `LiveRenderer`

当前分工是：

- `BaseRenderer` 负责从当前已加载区块收集静态对象，并重绘到 `baseCanvas`
- `baseRenderScheduler` 负责把 base 层的多次失效请求合并为单帧 flush
- `RenderScheduler` 负责把多次 invalidate 合并为单帧 flush
- `LiveRenderer` 负责从 `ActiveObjectManager` 读取活动对象，并按层顺序重绘到 `liveCanvas`
- Monitor 负责把这两者绑定到具体视口实例上

当前实现里，Monitor 还额外承担两件与活动层局部重绘直接相关的事情：

- 通过 `worldRectToScreenRect()` 把世界空间矩形统一换算为当前视口的屏幕矩形
- 把 `RenderScheduler.flush(dirtyRects)` 透传到 `LiveRenderer.flush(dirtyRects)`

对于静态层，当前又多了两件事情：

- 把 `baseRenderScheduler.flush(dirtyRects)` 透传到 `BaseRenderer.flush(dirtyRects)`
- 监听当前 `chunkBlockLoader` 的缓冲区更新，并把旧区块与新区块的矩形转成 base 层脏区

另外，`Monitor` 现在还会把视口变化本身折算成静态层脏区：

- `origin` 变化时，先记录旧视口下可见的区块集合，再用新区块集合与之合并失效
- `zoom` 变化时，同样会同时保留旧视口和新视口两套区块矩形，避免旧像素残留

这意味着“活动对象属于谁”仍由 AOM 决定，而“活动对象如何显示在当前视口里”则由 Monitor 侧负责。

## 设备树

设备树是挂载在 Monitor 下的树形结构。设备本身以子树定义的形式接入，而树上的每个节点只负责处理信号。

业务侧挂载设备时，应优先通过 `monitor.mountDevice(path, deviceDefinition)` 进入。这个便捷入口会自动补上当前 `monitorId`，再转交给底层 `devicesTree.mountDevice(rootPath, deviceDefinition)`。

若设备已经挂载，业务侧应通过 `board.signalsEventBus.emit("configure", { to, options })` 动态更新某个设备节点的 `rewritePacket`、`processor` 或 `defaultPath`。

它的作用有两点：

- 把设备状态显化并封存在节点中。
- 按节点路径分发和处理信号包。

在 Core-UI Interface 中，事件的接收者仍然是 Board，但可以通过节点定位，将信号分发到设备子树中的不同节点。

设备树的例子详见设备文档中[设备的状态压缩](../../devices/docs/device-document.md#设备的状态压缩)部分。

当前设备树的数据结构与路由规则见[设备树文档](../../devices/docs/devices-tree-document.md)。

## Monitor 与键盘输入边界

Monitor 是键盘设备的归属边界，但不是所有键盘输入都会自动成为键盘设备信号。

当前建议做法是：

- 先在宿主侧判断当前按键是否属于这个 Monitor
- 再判断该按键是否用于操作这个 Monitor，或最终会被某个工具消费
- 只有满足这两个条件之一，才把该事件编码成 `SignalPacket` 发到 `/${monitorId}/keyboard`

这意味着 Monitor 负责提供“输入归属到哪块视口”的边界，而不负责替应用层区分“这是设备操作”还是“这是全局快捷键”。

例如：

- 某个获得焦点的 Monitor 用 `Space` 驱动临时工具，这个 `Space` 应发到该 Monitor 的键盘设备
- `Command+S` 保存白板，则应直接由宿主 UI 处理，而不是先发送到某个 Monitor 的设备树

这样可以保持两条边界稳定：

- 设备树只接收设备语义的输入
- 应用级命令快捷键仍停留在宿主层

## 坐标语义

Monitor 当前还承担一层很关键的视口坐标规整职责。

它至少暴露两种坐标映射能力：

- `screenToWorld()`：屏幕坐标到世界坐标
- `screenToChunk()`：屏幕坐标到区块空间与区块 id
- `worldToChunk()`：世界坐标到区块空间与区块 id

这两者的分工是：

- Core 外围若还持有屏幕坐标，可先通过 `screenToWorld()` 规整成世界坐标
- Tool 消费输入时，默认位置语义直接使用世界坐标
- 当工具需要知道对象应归属哪一区块时，再通过 `worldToChunk()` 取 `chunkId`

也就是说，当前 creator 链路里：

- `position` 默认是世界坐标
- `ownerChunkId` 默认来自 `worldToChunk()`
- 区块内局部几何是否需要额外换算，由具体对象工具自己负责

这使 Monitor 成为“屏幕视口”与“白板世界”之间的稳定边界；但这种换算现在应尽量发生在信号进入 Core 之前，而不是散落在工具包装层里各自实现。

## 当前实现状态

- 已实现：设备树挂载入口、世界坐标与区块坐标换算、多层画布骨架、`BaseRenderer` 挂载、`baseRenderScheduler` 挂载、`RenderScheduler` 挂载、`LiveRenderer` 挂载、`worldRectToScreenRect()`。
- 已兼容：旧调用方仍可通过 `monitor.canvas` 访问交互层画布，现阶段它等价于 `liveCanvas`。
- 已接入：活动层 dirty rect 已可沿 `monitor.renderScheduler -> liveRenderer.flush(dirtyRects)` 这条链路执行；静态层 dirty rect 已可沿 `monitor.baseRenderScheduler -> baseRenderer.flush(dirtyRects)` 这条链路执行；区块缓冲区变化与视口变化也会自动触发 base 层刷新，并同时覆盖旧区块与新区块。
- 待完善：DPR 统一处理、dirty rect 合并策略进一步优化、`baseCanvas` 的区块级增量补绘，以及 `uiCanvas` 的专用渲染器。

## 相关文档

- [base-renderer-document.md](./base-renderer-document.md)
- [render-scheduler-document.md](./render-scheduler-document.md)
- [live-renderer-document.md](./live-renderer-document.md)
