# 显示器组件文档

本文档提供白板中的重要组件——显示器组件（Monitor）的概述。

## 显示器组件

显示器组件是设备图的挂载点。它本身不承担普通设备的输入语义，而是负责承载视口画布、维护设备子图，并把 Core 的结果组织成可显示的 UI。

Monitor 对应一个 monitor-root 容器，容器内包含多层渲染画布
（通过 `LiveRenderer` 手动合成，替代浏览器 CSS `z-index` 图层合成）：

- `baseCanvas`：静态对象缓存层（CSS `opacity: 0` 隐藏）。存放已落盘区块中对象的渲染结果，作为 `liveCanvas` 的预渲染缓存
- `liveCanvas`：唯一显示面（可见）。先通过 `drawImage` 拷贝 `baseCanvas` 像素作为静态背景，再绘制 AOM 中当前应显示的对象到上层
- `uiCanvas`：交互覆盖层，存放选择框、工具轨迹、控制杆、激光笔等短期 overlay

`liveCanvas` 是 Monitor 对外可见的唯一画布，`baseCanvas` 作为内部离屏缓存。`uiCanvas` 更适合承载短生命周期 overlay：

- 为了表明对象已被选中的矩形框
- 使用对象选择工具时的轨迹
- 控制杆
- 激光笔轨迹

但这里有一个当前阶段必须保留的不确定性：`uiCanvas` 最终应由 Core 管理，还是由宿主 UI 管理，还没有完全定案。

因此，当前 Core 内部的 `UiRenderer` 只是一层兼容实现：先把 `uiCanvas` 渲染链接起来，同时保留未来上移到宿主 UI 的空间。

注：现阶段仍输出 DOM 结构与 `HTMLCanvasElement`，未来可能改为 `ReactElement`。

为兼容旧代码，`monitor.canvas` 当前指向 `liveCanvas`（fallback 到 `baseRenderer.canvas`）。

## 渲染职责

Monitor 是输入与设备图边界，也是视口层渲染边界。每层渲染器的画布、调度器、脏区策略都由各渲染器自管理。

Monitor 持有的三个渲染器实例：

- `baseRenderer`（`BaseRenderer`）—— 静态层渲染器，自管理 baseCanvas 和 base 调度器
- `liveRenderer`（`LiveRenderer`）—— 活动层渲染器，自管理 liveCanvas 和 live 调度器
- `uiRenderer`（`UiRenderer`）—— UI 覆盖层渲染器，自管理 uiCanvas 和 ui 调度器

当前分工是：

- `BaseRenderer` 负责从当前已加载区块收集静态对象，并重绘到 `baseCanvas`
- `LiveRenderer` 负责从 `ActiveObjectManager` 读取当前仍在 AOM 中的对象，按层顺序重绘到 `liveCanvas`，并通过 `copyBase()` 把 `baseCanvas` 缓存合成到屏幕上
- `UiRenderer` 负责把兼容 overlay 与注册的 UI overlay provider 绘制到 `uiCanvas`
- Monitor 负责把上述渲染链绑定到具体视口实例上，并在视口/尺寸变化时推动各层刷新

Monitor 向各层渲染器提供：

- 视口信息（`origin`、`zoom`）
- 世界 ↔ 屏幕坐标换算（`worldRectToScreenRect()`、`screenToWorld()`）
- 区块加载接口（`chunkLoader`、`syncChunkBufferWithViewport()`）

以下渲染实现细节已内聚到各渲染器内部：

- `baseRenderScheduler` / `renderScheduler` / `uiRenderScheduler` → 各 renderer 自管 `_scheduler`
- `baseDirtyRectThresholdStrategy` / `liveDirtyRectThresholdStrategy` → 各 renderer 自管阈值策略
- `baseDirtyRectPolicyResolver` / `liveDirtyRectPolicyResolver` → 各 renderer 自管合路器
- `createDirtyRectMerger()` / `getDirtyRectPolicy()` / `getDirtyRectThresholds()` → 渲染器内部
- `getContext(layer)` → 各 renderer 直接访问 `_canvas.getContext("2d")`
- `attachRenderLayers()` → canvas 通过构造参数传入

## 缓存合成流水线

`LiveRenderer` 在 `liveCanvas` 上执行手动合成，替代浏览器 CSS `z-index` 图层合成。

`baseCanvas` 设置为 `opacity: 0` 隐藏，作为 `liveCanvas` 的预渲染缓存，由 `BaseRenderer` 维护。

### 三步流水线

`LiveRenderer.render()` 每帧按 clear → copyBase → render 顺序执行：

1. `clear()` 或 `clearDirtyRects()` 清理 `liveCanvas` 上的旧像素
2. `copyBase()` 或 `copyBaseRects()` 从 `baseCanvas`（缓存）拷贝静态层像素到 `liveCanvas`
3. 按 AOM 层顺序绘制当前仍在 AOM 中的对象到 `liveCanvas`

全量刷新与脏区刷新走同一套流水线，区别在于第一步和第二步的作用范围：

| 模式 | clear                    | copyBase                   | render              |
| ---- | ------------------------ | -------------------------- | ------------------- |
| 全量 | `clear()` 整画布         | `copyBase()` 全量拷贝      | 全部 AOM 对象       |
| 脏区 | `clearDirtyRects()` 局部 | `copyBaseRects()` 脏区拷贝 | 命中脏区的 AOM 对象 |

### 缓存时序保证

由于 base 和 live 的调度器是彼此独立的 rAF 调度器，`render()` 在拷贝 `baseCanvas` 前会检查 `baseRenderer._scheduler.framePending`，若有待处理帧则同步调用 `flush()`，确保读到最新的缓存状态。

### 设计原因

- `drawImage` 的默认 `source-over` 合成模式下，源像素 alpha=0 时不覆盖目标像素；必须先 `clear` 再拷贝，防止旧像素层层叠加
- `baseCanvas` 只包含静态对象（AOM 对象已被 `BaseRenderer` 过滤），拷贝结果天然不含 AOM 对象
- 三步流水线替代了浏览器 GPU 图层合成，使渲染结果的确定性完全由 JS 控制

## 画布尺寸管理

Monitor 通过各 renderer 的 `canvas` getter 访问画布实例：

| Getter        | 返回值                                       | 说明                          |
| ------------- | -------------------------------------------- | ----------------------------- |
| `width`       | `this.canvas?.width ?? 0`                    | 当前可见画布宽度              |
| `height`      | `this.canvas?.height ?? 0`                   | 当前可见画布高度              |
| `canvas`      | `liveRenderer.canvas ?? baseRenderer.canvas` | 可见画布（当前为 liveCanvas） |
| `chunkWidth`  | `this.board?.width ?? 0`                     | 区块宽度（由 Board 定义）     |
| `chunkHeight` | `this.board?.height ?? 0`                    | 区块高度（由 Board 定义）     |

### 尺寸变更流程

渲染层尺寸变化由 `resizeRenderLayers(width, height)` 触发，流程为：

1. 逐 renderer 调用 `renderer.resize(width, height)`
2. 任一 renderer 实际发生变更时调用 `requestRenderLayersRefresh()`
3. `requestRenderLayersRefresh()` 依次触发：
   - `requestViewportBaseRender()` — 静态层补绘
   - `liveRenderer.invalidateViewport()` — 活动层补绘
   - `uiRenderer.invalidateViewport()` — UI 层补绘

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
- 若业务要做"按当前状态平移 200"或"当前缩放乘 2"，应在更上层把增量先换算成目标值，再交给 `Monitor`

`setViewportState()` 内部会：

1. 记录变更前的可见区块集合（`previousChunks`）和视口状态（`previousViewportState`）
2. 更新 `_origin` 和 `_zoom`
3. 调用 `requestViewportBaseRender(previousChunks, previousViewportState)` 使旧视口和新视口下的区块同时失效
4. 调用 `liveRenderer.invalidateViewport()` 和 `uiRenderer.invalidateViewport()` 触发活动层和 UI 层补绘

`flushViewportRender()` 内部会：

1. 调用 `syncChunkBufferWithViewport()` 确保区块加载
2. 逐层调用 `renderer.invalidate(viewportRect)` 触发全屏刷新

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
- 把"是否允许驱逐旧区块"的语义稳定地绑定到 `Board.isPersistent()`，比在 demo 侧散落判断更可靠

## 设备图

设备图由 Board 持有，Monitor 提供挂载代理入口。

业务侧挂载子图时，应优先通过 `monitor.mountSubDAG(subDAGDefinition)` 或 `monitor.mountSubDAG(pathPrefix, subDAGDefinition)` 进入。这个入口会把相对当前 Monitor 的路径补全后，再转交给底层 `board.devicesDAG.mountSubDAG(basePath, subDAGDefinition)`。

业务侧挂载 workflow 时，应统一写到 `/<monitorId>/workflows/<name>` 下，再通过 `monitor.mountWorkflow(path, workflow)` 进入。设备节点与 workflow 入口之间通过 `addEdge` 连接；逻辑路由路径仍可表现为 `/keyboard/code/KeyW/tool` 或 `/mouse/pointer/tool` 这类以边名收束的路径。

## Monitor 与键盘输入边界

Monitor 是键盘设备的归属边界，但不是所有键盘输入都会自动成为键盘设备信号。

当前建议做法是：

- 先在宿主侧判断当前按键是否属于这个 Monitor
- 再判断该按键是否用于操作这个 Monitor，或最终会被某个工具消费
- 只有满足这两个条件之一，才把该事件编码成 `SignalPacket` 发到 `/${monitorId}/keyboard`

这意味着 Monitor 负责提供"输入归属到哪块视口"的边界，而不负责替应用层区分"这是设备操作"还是"这是全局快捷键"。

## 坐标语义

Monitor 承担视口坐标规整职责。坐标映射方法均通过 `canvas` getter 获取画布引用。

### 坐标映射方法

| 方法                                              | 说明                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `screenPointToWorld(screenPoint, origin?, zoom?)` | 将屏幕坐标换算为世界坐标（纯数学计算，不依赖画布 DOM）            |
| `screenToWorld(screenPos)`                        | 将屏幕坐标换算为世界坐标（基于 `canvas.getBoundingClientRect()`） |
| `screenToChunk(screenPos)`                        | 将屏幕坐标换算为区块空间坐标                                      |
| `worldToChunk(worldPos)`                          | 将世界坐标换算为区块空间坐标与区块 id                             |
| `worldRectToScreenRect(rect, padding?)`           | 将世界矩形范围映射为屏幕矩形范围                                  |

### 视口查询方法

| 方法                                          | 说明                                            |
| --------------------------------------------- | ----------------------------------------------- |
| `getViewportScreenRect()`                     | 获取当前视口的屏幕矩形（基于 `width`/`height`） |
| `getViewportWorldRect(origin?, zoom?)`        | 获取当前视口对应的世界矩形（基于 `width/zoom`） |
| `getViewportScreenCenter()`                   | 获取当前视口的屏幕中心点                        |
| `getVisibleChunksForViewport(origin?, zoom?)` | 获取当前视口下可见的区块集合                    |

## 当前实现状态

- 已实现：设备图挂载入口、世界坐标与区块坐标换算、三层画布骨架（`baseCanvas`/`liveCanvas`/`uiCanvas`）、`BaseRenderer`/`LiveRenderer`/`UiRenderer` 三渲染器实例（各渲染器自管 canvas、调度器、脏区策略）、`worldRectToScreenRect()`、`resizeRenderLayers()` 尺寸管理（委托各 renderer.resize）、`width`/`height`/`canvas` 统一 getter。
- 已兼容：`monitor.canvas` 返回 `liveRenderer.canvas`（fallback 到 `baseRenderer.canvas`），旧调用方可通过此访问可见画布。
- 已接入：活动层 dirty rect 通过 `liveRenderer.invalidateViewport()` / `liveRenderer.invalidate(rect)` 驱动；静态层 dirty rect 通过 `baseRenderer.invalidateChunks()` / `baseRenderer.invalidateViewport()` 驱动；ui 层 dirty rect 通过 `uiRenderer.invalidateViewport()` / `uiRenderer.invalidate(rect)` 驱动；区块缓冲区变化与视口变化也会自动触发 base 层刷新；视口平移/中心缩放/全屏 flush 已有显式 API；memory 白板下的 chunk buffer 已切到增量扩展策略。
- 待完善：DPR 统一处理、dirty rect 合并策略进一步优化、`baseCanvas` 的区块级增量补绘、ui overlay 真实语义与最终宿主边界的进一步收敛。

## 相关文档

- [base-renderer-document.md](./base-renderer-document.md)
- [render-scheduler-document.md](./render-scheduler-document.md)
- [live-renderer-document.md](./live-renderer-document.md)
- [ui-renderer-document.md](./ui-renderer-document.md)
- [board-document.md](./board-document.md)
