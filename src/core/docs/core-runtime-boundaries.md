# Core 运行边界（Worker / UI / Shared）

本文档整理 `src/core/` 当前各模块的运行边界。

这里的“运行边界”指的是：

- **Worker**：进入 `src/core-worker.js` 的模块图，在 Core Worker 线程运行
- **UI**：运行在浏览器主线程，直接接触 DOM、DevicesDAG、signalsEventBus 或宿主输入
- **Shared**：同时被 Worker 与 UI 侧引用的纯逻辑模块

## 总览

| 目录 / 文件                                         | 运行边界            | 说明                                                                                        |
| --------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `bridges/board-api.js`                              | UI（`BoardApiRpc`） | UI 侧 RPC 客户端，高频写入使用微任务批处理合并为 `rpc-batch` 消息                           |
| `bridges/persistence-adapter.js`                    | Shared              | 持久化接口与默认内存适配                                                                    |
| `components/chunk/`                                 | Shared              | 区块、区块加载器、区块静态图管理                                                            |
| `components/orchestration/board-core.js`            | Worker              | Core 侧真实白板数据与协调中心                                                               |
| `components/orchestration/board.js`                 | UI                  | UI facade，负责 signals / DAG / viewport / 通过 Worker 与 BoardCore 通信                    |
| `components/orchestration/viewport-core.js`         | Worker              | Worker 侧视口与 OffscreenCanvas 渲染核心                                                    |
| `components/orchestration/viewport.js`              | UI                  | UI 侧视口，持有 DOM canvas，接收 Worker 侧渲染帧                                            |
| `components/orchestration/active-object-manager.js` | Worker              | AOM 纯语义核心，通过 renderHooks 接入具体渲染链。UI 侧不持有 AOM                            |
| `components/orchestration/aom-render-hooks.js`      | Shared              | renderHooks 接口与默认空实现                                                                |
| `components/orchestration/board-render-hooks.js`    | UI                  | UI 侧渲染钩子（Worker mode 下为本地 BoardCore 的占位实现，实际 AOM 渲染走 Worker 侧 hooks） |
| `components/renderer/canvas-lifecycle.js`           | Shared              | 画布生命周期基类（CanvasHost），所有渲染器共用                                              |
| `components/renderer/ui-renderer.js`                | UI                  | UI overlay 渲染                                                                             |
| `components/renderer/ui-overlay-factory.js`         | Shared              | UI overlay 条目工厂纯函数                                                                   |
| `components/renderer/base-renderer.js`              | Worker              | Base 层渲染器，仅使用 OffscreenCanvas（Worker 侧合成用）                                    |
| `components/renderer/live-renderer.js`              | Worker              | Live 层渲染器，仅使用 OffscreenCanvas（Worker 侧合成用）                                    |
| `components/renderer/renderer.js`                   | Shared              | 渲染器基类（继承 CanvasHost）                                                               |
| `components/renderer/render-scheduler.js`           | Shared              | 脏区调度                                                                                    |
| `components/renderer/dirty-rect-*.js`               | Shared              | 脏区策略                                                                                    |
| `devices/`                                          | UI                  | 鼠标 / 键盘 / 触屏输入设备定义                                                              |
| `devices-dag/`                                      | UI                  | 设备图、handlerContext、信号路由                                                            |
| `hit/`                                              | Worker              | Undo Tree 与历史结构                                                                        |
| `objects/`                                          | Shared              | 白板对象模型与反序列化                                                                      |
| `prefixs/`                                          | UI                  | handoff / edge prefix / 子图编排                                                            |
| `range/`                                            | Shared              | 几何范围抽象                                                                                |
| `shared/`                                           | Shared              | 跨线程共享类型定义                                                                          |
| `tools/`                                            | UI                  | creator / chooser / modifier / eraser 等交互工具                                            |
| `utils/`                                            | Shared              | 数学、图结构、事件总线等通用工具                                                            |
| `test-support/`                                     | Shared（测试）      | canvas / OffscreenCanvas mock 等测试支撑                                                    |

## 目录级说明

### `bridges/`

- `BoardApiRpc` 是 **UI 线程 RPC 客户端**，负责把工具读写请求发往 Worker。`modifyObject` / `appendListItem` / `replaceListItem` / `removeListItem` 四类高频调用使用微任务缓冲，同 id 自动合并，非批处理调用（如 `commitObjects`）会先同步 flush 当前队列以保证时序
- `persistence-adapter.js` 只定义接口和默认适配，不直接决定运行线程

### `components/`

这是运行边界最混合的一层。

#### `orchestration/`

- `BoardCore` / `ViewportCore` 是 Worker 侧真实核心
- `Board` / `Viewport` 是 UI 侧宿主
- `ActiveObjectManager` 是纯 Worker 侧模块，通过 `renderHooks` 把渲染副作用延后到调用方决定

#### `chunk/`

区块系统是共享模块：

- Worker 侧用它维护真实静态图、覆盖区块索引与加载状态
- Worker 侧使用它维护真实静态图

#### `renderer/`

- `UiRenderer` 只在 UI 侧使用，因为它直接操作 `Viewport.uiCanvas`
- `BaseRenderer` / `LiveRenderer` / `RenderScheduler` / dirty rect 策略本身不依赖 DOM，当前属于 Shared

### `devices/` / `devices-dag/` / `tools/` / `prefixs/`

这四类模块全部停留在 UI 线程：

- 设备树与 DAG 路由由 `Board.signalsEventBus` 驱动
- tools 直接消费设备信号、维护节点 state、声明 overlay provider
- handoff / prefix 是 UI 侧输入编排逻辑，不进入 Worker

### `objects/` / `range/` / `utils/` / `shared/`

这几类目录是当前 Core Worker 架构的稳定共享层：

- 不依赖 DOM
- 不依赖 DevicesDAG
- 不依赖宿主桥接
- 可在 Worker 和 Node 测试环境下直接 import

## 当前数据权威关系

### 对象与区块

- **Worker 侧 `BoardCore`** 是对象、区块、AOM 与提交关系的真实权威
- **UI 侧工具** 通过 `BoardApiRpc` 读写 Worker 状态（高频写入经微任务批处理合并后发送）
- creator 的本地 `_entry`、chooser / modifier 的轻量对象条目都只是 **交互态镜像**，不是权威数据源

### 视口与渲染

- **Worker 侧 `ViewportCore`** 负责 base/live 两层的真实补绘与帧输出
- **UI 侧 `Viewport`** 负责接收 `render-frame` 并把合成位图绘制到 DOM canvas
- **UI 侧 `UiRenderer`** 负责 overlay
- mutation RPC（`modifyObject` 等）在 Core 侧自动调用 `requestLiveRender` 触发
  live 层失效并安排立即 flush，Tool 层无需自行处理 live 渲染

### objectId 分配

- `Board.allocateObjectId()` 在 UI 侧用本地 `CounterPool` 同步分配
- Worker 侧 createObject 要求显式传入 `props.id`
- Worker 若收到重复 id，会抛错并通过 `rpc-response` 返回错误

## 当前默认运行模式

demo / `src/templates/whiteboard.js` 的初始化流程：

1. UI 线程创建 `Worker(new URL("../core-worker.js", import.meta.url))`
2. `Board.enableWorkerMode(worker)` 初始化 `BoardApiRpc`
3. `Board.createViewport(...)` 返回 `Viewport`
4. `Viewport` 通过 `createViewport` RPC 驱动 Worker 创建 `ViewportCore`
5. tools 保持 UI 线程执行，通过 RPC 与 Worker 侧 `BoardCore` 协作

## 相关文档

- [core-overview.md](./core-overview.md)
- [core-modules.md](./core-modules.md)
- [components-document.md](./components/components-document.md)
- [board-document.md](../ui/components/orchestration/docs/board-document.md)
- [viewport-document.md](../ui/components/orchestration/docs/viewport-document.md)
