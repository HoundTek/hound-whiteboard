# 显示器组件文档

本文档提供白板中的重要组件——显示器组件（Monitor）的概述。

## 显示器组件

显示器组件是设备图的挂载点。它本身不承担普通设备的输入语义，而是负责承载视口画布、维护设备子图，并把 Core 的结果组织成可显示的 UI。

当前实现里，Monitor 不再只对应单个 `canvas`，而是对应一个 monitor-root 容器。这个容器内包含多层渲染画布：

- `baseCanvas`：静态对象层，存放已落盘区块中对象的渲染结果
- `liveCanvas`：活动对象层，存放当前活动对象的渲染结果
- `renderCanvas`：合成输出层，负责将 `baseCanvas` + `liveCanvas` 合成后输出到屏幕（对外可见）
- `uiCanvas`：交互覆盖层，存放选择框、工具轨迹、控制杆、激光笔等短期 overlay

`renderCanvas` 是 Monitor 对外可见的唯一画布，`baseCanvas` 和 `liveCanvas` 作为内部离屏图层参与合成。当前 `uiCanvas` 更适合承载短生命周期 overlay：

- 为了表明对象已被选中的矩形框
- 使用对象选择工具时的轨迹
- 控制杆
- 激光笔轨迹

但这里有一个当前阶段必须保留的不确定性：`uiCanvas` 最终应由 Core 管理，还是由宿主 UI 管理，还没有完全定案。

因此，当前 Core 内部的 `UiRenderer` 只是一层兼容实现：先把 `uiCanvas` 渲染链接起来，同时保留未来上移到宿主 UI 的空间。

注：现阶段仍输出 DOM 结构与 `HTMLCanvasElement`，未来可能改为 `ReactElement`。

为兼容旧代码，`monitor.canvas` 当前指向可见画布的候选顺序：`renderCanvas` > `liveCanvas` > `baseCanvas`。

## 渲染职责

Monitor 当前不仅是输入与设备图边界，也是视口层渲染边界。

它会持有并协调：

- 多层 canvas 的尺寸同步
- 视口原点 `origin`
- 缩放比例 `zoom`
- `BaseRenderer`
- `baseRenderScheduler`
- `RenderScheduler`
- `uiRenderScheduler`
- `LiveRenderer`
- `UiRenderer`

当前分工是：

- `BaseRenderer` 负责从当前已加载区块收集静态对象，并重绘到 `baseCanvas`
- `baseRenderScheduler` 负责把 base 层的多次失效请求合并为单帧 flush
- `RenderScheduler` 负责把多次 invalidate 合并为单帧 flush
- `uiRenderScheduler` 负责把 ui 层的多次失效请求合并为单帧 flush
- `LiveRenderer` 负责从 `ActiveObjectManager` 读取活动对象，并按层顺序重绘到 `liveCanvas`
- `UiRenderer` 负责把兼容 overlay 与注册的 UI overlay provider 绘制到 `uiCanvas`
- Monitor 负责把上述渲染链绑定到具体视口实例上

当前 `UiRenderer` 默认接入的兼容 overlay 语义也已经收口：

- 不是“对象只要在 AOM 中就显示选择框”
- 而是“当前 chooser / modifier 工具主动声明对象选择框，各自矩形框外加组合大矩形”

当前 `Monitor` 还负责给 base/live 两条调度链分别注入不同的 dirty rect 聚合参数：

- 默认 zoom-aware 阈值现在已收敛到独立的 dirty rect 策略函数里
- `Monitor` 现在进一步把每一层的 `dirty rect policy` 收成统一入口
- policy 内同时包含阈值获取、视口矩形获取，以及 base 层的 canonical chunk 矩形获取
- `Monitor` 只负责按当前视口状态解析 base/live 两组 policy，并把它们接到调度器
- base 层里“屏幕 dirty rect -> 世界矩形 -> loaded chunk 子集 -> chunk 屏幕矩形”的换算，也已经下沉到 base policy resolver 中

- live 层更偏向积极合并近邻矩形，并在脏区已接近整视口时直接退化为整视口
- base 层更偏向保守合并近邻矩形，并在脏区覆盖足够多时优先退化为整 chunk；只有更大范围时才退化为整视口
- 这两组阈值现在还会跟随 `zoom` 动态变化：缩放越大，允许合并的近邻距离和额外扫描面积阈值也越大，从而让不同缩放比下的聚合行为更一致
- 同时，整视口 / 整 chunk 的退化阈值也会随 `zoom` 提高而变得更严格，避免高倍缩放时因为屏幕像素放大而过早退化

当前这条 Core 端收口后的后续扩展方向是：

- 把 base/live 的 dirty rect policy 进一步上移到更高层宿主，变成一个“viewport policy manager”，让 Monitor 仅负责 policy 的解析与接线；
- 把 base/live 的 policy 从“阈值 + canonical rect 候选”升级成更完整的 world-space invalidation policy；
- 把 base 层的 chunk 候选解析从 policy resolver 再进一步收窄为“chunk render region provider”，让 chunk 屏幕矩形与加载状态的边界更清晰；
- UI 层的策略属于交互/显示链路范畴，不在 Core 端做。

base 层的整 chunk 退化现在也不再只是看“当前可见 chunk 里有哪些矩形碰到了 dirty rect”。

- base policy resolver 会先把屏幕 dirty rect 反算成世界矩形
- 再只取这块世界范围真正覆盖到、并且当前已经加载的 chunk 子集
- 最后才把这些 chunk 的屏幕矩形作为整 chunk 退化候选

当前实现里，Monitor 还额外承担两件与活动层局部重绘直接相关的事情：

- 通过 `worldRectToScreenRect()` 把世界空间矩形统一换算为当前视口的屏幕矩形
- 把 `RenderScheduler.flush(dirtyRects)` 透传到 `LiveRenderer.flush(dirtyRects)`

对于静态层，当前又多了两件事情：

- 把 `baseRenderScheduler.flush(dirtyRects)` 透传到 `BaseRenderer.flush(dirtyRects)`
- 监听当前 `chunkBlockLoader` 的缓冲区更新，并把旧区块与新区块的矩形转成 base 层脏区

对于 UI 覆盖层，当前又多了一条兼容链路：

- 把 `uiRenderScheduler.flush(dirtyRects)` 透传到 `UiRenderer.flush(dirtyRects)`
- 通过 `registerUiOverlayProvider(...)` / `unregisterUiOverlayProvider(...)` 暴露 UI overlay 的兼容注册口

这里还要补一条当前实现约束：

- `AOM`、creator、modifier 会在合适时机推动 ui 层刷新
- 但 `UiRenderer` 默认并不会仅凭“AOM 中有对象”就绘制选择框
- 默认选择框仍以 chooser / modifier 工具当前声明的 provider 为准

另外，`Monitor` 现在还会把视口变化本身折算成静态层脏区：

- `origin` 变化时，先记录旧视口下可见的区块集合，再用新区块集合与之合并失效
- `zoom` 变化时，同样会同时保留旧视口和新视口两套区块矩形，避免旧像素残留

## 合成渲染管线

`renderCanvas` 作为 Monitor 对外可见的唯一画布，承载了 `baseCanvas` 与 `liveCanvas` 的合成输出。

合成由 `compositeRenderCanvas()` 执行，调用链路为：

1. 业务侧修改 base/live 层画布内容后，通过 `requestCompositeRender()` 发起一次异步合成请求
2. `requestCompositeRender()` 使用 `requestAnimationFrame`（fallback 为 `setTimeout(16ms)`）去重调度
3. 调度执行时，`compositeRenderCanvas()` 依次执行：`clearRect` 清空 → `drawImage(baseCanvas)` → `drawImage(liveCanvas)`
4. base 层的 flush handler 也会在 base 层绘制完成后自动触发 `requestCompositeRender()`

合成时序保证了：

- `_compositePending` 标志位避免同一帧内多次请求堆积
- `requestAnimationFrame` 让合成与浏览器帧同步
- `requestRenderLayersRefresh()` 在尺寸变化时也会触发合成

## 画布尺寸管理

Monitor 不再直接引用特定画布实例获取尺寸，而是通过统一 getter 收口：

| Getter        | 返回值                                   | 说明                      |
| ------------- | ---------------------------------------- | ------------------------- |
| `width`       | `this.canvas?.width ?? 0`                | 当前可见画布宽度          |
| `height`      | `this.canvas?.height ?? 0`               | 当前可见画布高度          |
| `canvas`      | `renderCanvas > liveCanvas > baseCanvas` | 可见画布的候选优先级      |
| `chunkWidth`  | `this.board?.width ?? 0`                 | 区块宽度（由 Board 定义） |
| `chunkHeight` | `this.board?.height ?? 0`                | 区块高度（由 Board 定义） |

`canvas` getter 的优先级保证了在同时安装了 `renderCanvas`（合成输出层）时，Monitor 的所有子模块（坐标换算、视口矩形、`getContext` 等）都自动使用正确的画布实例，而不需要调用方关心具体是哪一层。

### 尺寸变更流程

渲染层尺寸变化由 `resizeRenderLayers(width, height)` 触发，流程为：

1. 遍历 `baseCanvas`、`liveCanvas`、`renderCanvas`、`uiCanvas` 四层画布
2. 逐层检查 `width`/`height` 是否已为目标值，跳过已匹配的层
3. 实际发生变更时调用 `requestRenderLayersRefresh()`
4. `requestRenderLayersRefresh()` 依次触发：
   - `requestViewportBaseRender()` — 静态层补绘
   - `renderScheduler.invalidate(viewportRect)` — 活动层补绘
   - `uiRenderScheduler.invalidate(viewportRect)` — UI 层补绘
   - `requestCompositeRender()` — 合成输出

`attachRenderLayers()` 在绑定新画布层后也会自动调用 `resizeRenderLayers(this.width, this.height)`，确保新层与当前 Monitor 尺寸对齐。

## 视口控制 API

`Monitor` 当前提供一组显式的视口控制 API：

| 方法                                                                 | 说明                                    |
| -------------------------------------------------------------------- | --------------------------------------- |
| `setViewportPosition(position)`                                      | 直接将视口原点移动到指定世界坐标        |
| `setViewportScale(scale, screenAnchor?)`                             | 以给定屏幕锚点调整缩放比例              |
| `setViewportScaleAroundCenter(scale)`                                | 以当前视口中心点为锚点调整缩放比例      |
| `setViewportState({ origin?, zoom? })`                               | 一次性更新视口状态（origin 和/或 zoom） |
| `flushViewportRender()`                                              | 触发当前视口的 base/live/ui 全屏刷新    |
| `requestViewportBaseRender(previousChunks?, previousViewportState?)` | 请求视口范围内的静态层重绘              |
| `requestViewportLiveRender()`                                        | 请求视口范围内的活动层补绘              |
| `requestViewportUiRender()`                                          | 请求视口范围内的 UI 层补绘              |
| `registerUiOverlayProvider(provider, options?)`                      | 注册自定义 ui overlay provider          |
| `unregisterUiOverlayProvider(provider, options?)`                    | 注销自定义 ui overlay provider          |

这里的语义边界是：

- `position` 是世界空间里的视口原点，而不是增量偏移
- `scale` 是目标缩放值，而不是乘法因子
- 若业务要做“按当前状态平移 200”或“当前缩放乘 2”，应在更上层把增量先换算成目标值，再交给 `Monitor`

`setViewportState()` 内部会：

1. 记录变更前的可见区块集合（`previousChunks`）和视口状态（`previousViewportState`）
2. 更新 `_origin` 和 `_zoom`
3. 调用 `requestViewportBaseRender(previousChunks, previousViewportState)` 使旧视口和新视口下的区块同时失效
4. 调用 `requestViewportLiveRender()` 和 `requestViewportUiRender()` 触发活动层和 UI 层补绘

## 视口与区块缓冲策略

`Monitor` 当前还承担"视口变化后，如何同步 chunk buffer"的策略分流。

当前实现分为两类：

- `filesystem` 白板：沿用"按当前视口重建缓冲区"的方式，必要时 reset 再重建当前可见区块范围
- `memory` 白板：不主动卸载已加载区块，视口移动后只做增量扩展，把新进入可见范围的区块继续并入当前 buffer

逻辑由 `syncChunkBufferWithViewport()` 统一实现：

1. 获取当前视口可见区块集合
2. 通过 `board.isPersistent()` 判断持久化模式
3. `filesystem` 模式：`resetBuffer()` + 按可见范围初始化并扩展缓冲区
4. `memory` 模式：通过 `expandBufferLeftFullLoad()`、`expandBufferRightFullLoad()` 等增量方法逐边扩展

这样做的原因是：

- 纯内存 demo 不需要把视口离开的区块回收掉
- 若仍沿用 reset-and-rebuild，反而会在交互上不断触发无意义的 unload/reload 决策
- 把“是否允许驱逐旧区块”的语义稳定地绑定到 `Board.isPersistent()`，比在 demo 侧散落判断更可靠

这意味着“活动对象属于谁”仍由 AOM 决定，而“活动对象如何显示在当前视口里”则由 Monitor 侧负责。

## 设备图

当前设备图由 Board 持有，Monitor 只提供挂载代理入口，不再拥有独立实例。

业务侧挂载子图时，应优先通过 `monitor.mountSubDAG(subDAGDefinition)` 或 `monitor.mountSubDAG(pathPrefix, subDAGDefinition)` 进入。这个入口会把相对当前 Monitor 的路径补全后，再转交给底层 `board.devicesDAG.mountSubDAG(basePath, subDAGDefinition)`。

业务侧挂载 workflow 时，应统一写到 `/<monitorId>/workflows/<name>` 下，再通过 `monitor.mountWorkflow(path, workflow)` 进入。设备节点与 workflow 入口之间通过 `addEdge` 连接；逻辑路由路径仍可表现为 `/keyboard/code/KeyW/tool` 或 `/mouse/pointer/tool` 这类以边名收束的路径。

这里有一条新的路径约束：

- workflow 入口统一挂在 `/<monitorId>/workflows/` 下
- Monitor 负责补上 monitorId，不负责替业务修正跨层回跳路径
- 若某个节点需要公共逻辑，应显式挂 workflow 子树，而不是让子节点依赖跨层回跳

业务侧通过 mount 事件的 `edge.prefix` 字段在 device 节点与 workflow 之间注入信号转换，不再使用 `configure` 事件。

它的作用有两点：

- 把设备状态显化并封存在节点 state 中
- 按节点路径分发和处理信号包

当前设备图的数据结构与路由规则见[设备图文档](../../devices/docs/devices-dag-document.md)。

## Monitor 与键盘输入边界

Monitor 是键盘设备的归属边界，但不是所有键盘输入都会自动成为键盘设备信号。

当前建议做法是：

- 先在宿主侧判断当前按键是否属于这个 Monitor
- 再判断该按键是否用于操作这个 Monitor，或最终会被某个工具消费
- 只有满足这两个条件之一，才把该事件编码成 `SignalPacket` 发到 `/${monitorId}/keyboard`

这意味着 Monitor 负责提供“输入归属到哪块视口”的边界，而不负责替应用层区分“这是设备操作”还是“这是全局快捷键”。

例如：

- 某个获得焦点的 Monitor 用 `Space` 驱动临时工具，这个 `Space` 应发到该 Monitor 的键盘设备
- `Command+S` 保存白板，则应直接由宿主 UI 处理，而不是先发送到某个 Monitor 的设备图

这样可以保持两条边界稳定：

- 设备图只接收设备语义的输入
- 应用级命令快捷键仍停留在宿主层

## 坐标语义

Monitor 当前还承担一层很关键的视口坐标规整职责。它提供的坐标映射方法均已统一通过 `canvas` getter 获取画布引用，不再直接依赖 `liveCanvas`。

### 坐标映射方法

| 方法                                              | 说明                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `screenPointToWorld(screenPoint, origin?, zoom?)` | 将屏幕坐标换算为世界坐标（纯数学计算，不依赖画布 DOM）            |
| `screenToWorld(screenPos)`                        | 将屏幕坐标换算为世界坐标（基于 `canvas.getBoundingClientRect()`） |
| `screenToChunk(screenPos)`                        | 将屏幕坐标换算为区块空间坐标                                      |
| `worldToChunk(worldPos)`                          | 将世界坐标换算为区块空间坐标与区块 id                             |
| `worldRectToScreenRect(rect, padding?)`           | 将世界矩形范围映射为屏幕矩形范围                                  |

### 语义分工

- Core 外围若还持有屏幕坐标，可先通过 `screenToWorld()` 规整成世界坐标
- Tool 消费输入时，默认位置语义直接使用世界坐标
- 当工具需要知道对象应归属哪一区块时，再通过 `worldToChunk()` 取 `chunkId`
- `worldRectToScreenRect()` 用于世界矩形到屏幕矩形的映射，叠加当前 `origin` 和 `zoom`，并可附加 `padding` 留白

### 视口查询方法

| 方法                                          | 说明                                            |
| --------------------------------------------- | ----------------------------------------------- |
| `getViewportScreenRect()`                     | 获取当前视口的屏幕矩形（基于 `width`/`height`） |
| `getViewportWorldRect(origin?, zoom?)`        | 获取当前视口对应的世界矩形（基于 `width/zoom`） |
| `getViewportScreenCenter()`                   | 获取当前视口的屏幕中心点                        |
| `getVisibleChunksForViewport(origin?, zoom?)` | 获取当前视口下可见的区块集合                    |

也就是说，当前 creator 链路里：

- `position` 默认是世界坐标
- `ownerChunkId` 默认来自 `worldToChunk()`
- 区块内局部几何是否需要额外换算，由具体对象工具自己负责

这使 Monitor 成为“屏幕视口”与“白板世界”之间的稳定边界；但这种换算现在应尽量发生在信号进入 Core 之前，而不是散落在工具包装层里各自实现。

## 脏区策略 API

Monitor 对外提供了一层脏区策略查询接口，供调度器决定如何合并 dirty rect：

| 方法                            | 说明                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| `createDirtyRectMerger(layer)`  | 创建指定渲染层的脏区聚合器，内部调用 `createRectangleDirtyRectMerger`      |
| `getDirtyRectPolicy(layer)`     | 获取指定渲染层的完整 dirty rect policy（含阈值、视口矩形、canonical rect） |
| `getDirtyRectThresholds(layer)` | 获取指定渲染层的当前 dirty rect 阈值                                       |

base 层和 live 层使用不同的 policy resolver：

- `baseDirtyRectPolicyResolver`：包含 chunk 级的 canonical rect 换算（屏幕 dirty rect → 世界矩形 → loaded chunk 子集 → chunk 屏幕矩形）
- `liveDirtyRectPolicyResolver`：仅含阈值与视口矩形，不涉及 chunk 换算

ui 层当前直接使用 `createRectangleDirtyRectMerger` 的默认行为，不额外配置 policy resolver。

## 当前实现状态

- 已实现：设备图挂载入口、世界坐标与区块坐标换算、多层画布骨架、`BaseRenderer` 挂载、`baseRenderScheduler` 挂载、`RenderScheduler` 挂载、`uiRenderScheduler` 挂载、`LiveRenderer` 挂载、`UiRenderer` 挂载、`worldRectToScreenRect()`、异步合成渲染管线（`requestCompositeRender()` + `compositeRenderCanvas()`）、`attachRenderLayers()` / `resizeRenderLayers()` 尺寸管理、`width`/`height`/`canvas` 统一 getter。
- 已兼容：旧调用方仍可通过 `monitor.canvas` 访问可见画布，现阶段它按 `renderCanvas > liveCanvas > baseCanvas` 优先级返回。
- 已接入：活动层 dirty rect 已可沿 `monitor.renderScheduler -> liveRenderer.flush(dirtyRects)` 链路执行；静态层 dirty rect 已可沿 `monitor.baseRenderScheduler -> baseRenderer.flush(dirtyRects)` 链路执行；ui 层 dirty rect 已可沿 `monitor.uiRenderScheduler -> uiRenderer.flush(dirtyRects)` 链路执行；区块缓冲区变化与视口变化也会自动触发 base 层刷新，并同时覆盖旧区块与新区块；视口平移/中心缩放/全屏 flush 已有显式 API；memory 白板下的 chunk buffer 已切到增量扩展策略；各坐标映射方法已统一通过 `canvas` getter 获取画布引用。
- 待完善：DPR 统一处理、dirty rect 合并策略进一步优化、`baseCanvas` 的区块级增量补绘、ui overlay 真实语义与最终宿主边界的进一步收敛。

## 相关文档

- [base-renderer-document.md](./base-renderer-document.md)
- [render-scheduler-document.md](./render-scheduler-document.md)
- [live-renderer-document.md](./live-renderer-document.md)
- [ui-renderer-document.md](./ui-renderer-document.md)
- [board-document.md](./board-document.md)
