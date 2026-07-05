# Core 运行边界（Worker / UI / Shared）

本文档整理 `src/core/` 当前各模块的运行边界。

这里的“运行边界”指的是：

- **Worker**：进入 `src/core-worker.js` 的模块图，在 Core Worker 线程运行
- **UI**：运行在浏览器主线程，直接接触 DOM、DevicesDAG、signalsEventBus 或宿主输入
- **Shared**：同时被 Worker 与 UI 侧引用的纯逻辑模块

## 总览

| 目录 / 文件                                         | 运行边界            | 说明                                                           |
| --------------------------------------------------- | ------------------- | -------------------------------------------------------------- |
| `bridges/board-api.js`                              | UI（`BoardApiRpc`） | UI 侧 RPC 客户端，通过 postMessage 与 Worker 侧 BoardCore 通信 |
| `bridges/persistence-adapter.js`                    | Shared              | 持久化接口与默认内存适配                                       |
| `components/chunk/`                                 | Shared              | 区块、区块加载器、区块静态图管理                               |
| `components/orchestration/board-core.js`            | Worker              | Core 侧真实白板数据与协调中心                                  |
| `components/orchestration/board.js`                 | UI                  | UI façade，负责 signals / DAG / monitor / Worker 模式切换      |
| `components/orchestration/monitor-core.js`          | Worker              | Worker 侧视口与 OffscreenCanvas 渲染核心                       |
| `components/orchestration/monitor-proxy.js`         | UI                  | Worker 模式下的视口代理，持有 DOM canvas                       |
| `components/orchestration/active-object-manager.js` | Shared              | AOM 纯语义核心，通过 renderHooks 接入具体渲染链                |
| `components/orchestration/aom-render-hooks.js`      | Shared              | renderHooks 接口与默认空实现                                   |
| `components/orchestration/board-render-hooks.js`    | UI                  | AOM 请求到 UI monitor 渲染器的桥接层                           |
| `components/renderer/ui-renderer.js`                | UI                  | UI overlay 渲染                                                |
| `components/renderer/base-renderer.js`              | Shared              | Base 层渲染器，兼容 DOM canvas / OffscreenCanvas               |
| `components/renderer/live-renderer.js`              | Shared              | Live 层渲染器，兼容 DOM canvas / OffscreenCanvas               |
| `components/renderer/renderer.js`                   | Shared              | 渲染器基类                                                     |
| `components/renderer/render-scheduler.js`           | Shared              | 脏区调度                                                       |
| `components/renderer/dirty-rect-*.js`               | Shared              | 脏区策略                                                       |
| `devices/`                                          | UI                  | 鼠标 / 键盘 / 触屏输入设备定义                                 |
| `devices-dag/`                                      | UI                  | 设备图、handlerContext、信号路由                               |
| `hit/`                                              | Shared              | Undo Tree 与历史结构                                           |
| `objects/`                                          | Shared              | 白板对象模型与反序列化                                         |
| `prefixs/`                                          | UI                  | handoff / edge prefix / 子图编排                               |
| `range/`                                            | Shared              | 几何范围抽象                                                   |
| `shared/`                                           | Shared              | 跨线程共享类型定义                                             |
| `tools/`                                            | UI                  | creator / chooser / modifier / eraser 等交互工具               |
| `utils/`                                            | Shared              | 数学、图结构、事件总线等通用工具                               |
| `test-support/`                                     | Shared（测试）      | canvas / OffscreenCanvas mock 等测试支撑                       |

## 目录级说明

### `bridges/`

- `BoardApiRpc` 是 **UI 线程 RPC 客户端**，负责把工具读写请求发往 Worker
- `persistence-adapter.js` 只定义接口和默认适配，不直接决定运行线程

### `components/`

这是运行边界最混合的一层。

#### `orchestration/`

- `BoardCore` / `MonitorCore` 是 Worker 侧真实核心
- `Board` / `MonitorProxy` 是 UI 侧宿主
- `ActiveObjectManager` 保持纯语义实现，通过 `renderHooks` 把渲染副作用延后到调用方决定

#### `chunk/`

区块系统是共享模块：

- Worker 侧用它维护真实静态图、覆盖区块索引与加载状态
- Worker 侧使用它维护真实静态图

#### `renderer/`

- `UiRenderer` 只在 UI 侧使用，因为它直接操作 `Monitor.uiCanvas`
- `BaseRenderer` / `LiveRenderer` / `RenderScheduler` / dirty rect 策略本身不依赖 DOM，当前属于 Shared

### `devices/` / `devices-dag/` / `tools/` / `prefixs/`

这四类模块全部停留在 UI 线程：

- 设备树与 DAG 路由由 `Board.signalsEventBus` 驱动
- tools 直接消费设备信号、维护节点 state、声明 overlay provider
- handoff / prefix 是 UI 侧输入编排逻辑，不进入 Worker

### `objects/` / `range/` / `utils/` / `hit/` / `shared/`

这几类目录是当前 Core Worker 架构的稳定共享层：

- 不依赖 DOM
- 不依赖 DevicesDAG
- 不依赖宿主桥接
- 可在 Worker 和 Node 测试环境下直接 import

## 当前数据权威关系

### 对象与区块

- **Worker 侧 `BoardCore`** 是对象、区块、AOM 与提交关系的真实权威
- **UI 侧工具** 通过 `BoardApiRpc` 读写 Worker 状态
- creator 的本地 `_local`、chooser / modifier 的 summary-like 条目都只是 **交互态镜像**，不是权威数据源

### 视口与渲染

- **Worker 侧 `MonitorCore`** 负责 base/live 两层的真实补绘与帧输出
- **UI 侧 `MonitorProxy`** 负责接收 `render-frame` 并把位图合成到 DOM canvas
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
3. `Board.createMonitor(...)` 返回 `MonitorProxy`
4. `MonitorProxy` 通过 `createMonitor` RPC 驱动 Worker 创建 `MonitorCore`
5. tools 保持 UI 线程执行，通过 RPC 与 Worker 侧 `BoardCore` 协作

## 相关文档

- [core-overview.md](./core-overview.md)
- [core-modules.md](./core-modules.md)
- [components-document.md](../components/docs/components-document.md)
- [board-document.md](../components/orchestration/docs/board-document.md)
- [monitor-document.md](../components/orchestration/docs/monitor-document.md)
