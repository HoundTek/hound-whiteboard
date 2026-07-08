# Core 运行边界（Worker / UI / Shared）

本文档整理 `src/core/` 当前各模块的运行边界。

这里的“运行边界”指的是：

- **UI**：浏览器主线程，可直接接触 DOM、DevicesDAG、宿主输入
- **Worker**：`src/core/worker/core-worker.js` 启动的 Core Worker 线程
- **Shared**：可在 UI、Worker、Node 测试环境中复用的纯逻辑
- **Host**：Tauri / preload / 主进程等宿主桥接层，不属于 Core 运行时本身，但与之交互

## 总览

| 目录 / 文件                                                | 运行边界 | 说明                                                            |
| ---------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `bridges/board-api.js`                                     | UI       | UI 侧 RPC 客户端，封装 `rpc` / `rpc-batch` / `rpc-response`     |
| `bridges/persistence-adapter.js`                           | Shared   | 持久化适配器协议与工厂，本身不依赖线程宿主                      |
| `bridges/file-operate-bridge-renderer.js`                  | UI       | 渲染线程侧文件桥调用入口                                        |
| `bridges/file-operate-bridge-main.js`                      | Host     | 宿主/主线程的真实文件系统实现                                   |
| `ui/components/orchestration/board.js`                     | UI       | UI 白板 facade、唯一 `DevicesDAG`、viewport 管理、Worker 初始化 |
| `ui/components/orchestration/viewport.js`                  | UI       | DOM canvas、overlay、Worker 同步、workflow 挂载代理             |
| `ui/components/orchestration/board-render-hooks.js`        | UI       | 本地渲染路径用的 render hook 辅助                               |
| `ui/components/renderer/ui-renderer.js`                    | UI       | UI overlay 渲染                                                 |
| `ui/devices-dag/**`                                        | UI       | 设备图、设备子图、prefix、tool 全部在 UI 线程                   |
| `worker/core-worker.js`                                    | Worker   | Worker 入口与 `CoreWorkerRuntime`                               |
| `worker/components/orchestration/board-core.js`            | Worker   | 对象、区块、AOM、UndoTree、持久化协调                           |
| `worker/components/orchestration/viewport-core.js`         | Worker   | Worker 视口状态、区块缓冲、渲染帧输出                           |
| `worker/components/orchestration/active-object-manager.js` | Worker   | 动态图与交互态对象生命周期                                      |
| `worker/components/orchestration/aom-render-hooks.js`      | Worker   | Worker 侧使用的 render hook 协议与默认实现                      |
| `worker/components/chunk/**`                               | Worker   | 区块、加载器、静态图、覆盖区块索引                              |
| `worker/components/renderer/**`                            | Worker   | Worker 侧 base/live 渲染器                                      |
| `worker/hit/**`                                            | Worker   | UndoTree 与操作结构                                             |
| `shared/objects/**`                                        | Shared   | 对象模型与反序列化                                              |
| `shared/range/**`                                          | Shared   | 几何范围与碰撞判断                                              |
| `shared/renderer/**`                                       | Shared   | 渲染器基类、调度器、共享脏区策略                                |
| `shared/types/**`                                          | Shared   | 跨线程共享 typedef 与协议                                       |
| `utils/**`                                                 | Shared   | 数学、图结构、事件总线、路径、计数池                            |
| `test-support/**`                                          | Shared   | 测试 mock 与 fixture                                            |

## 目录级说明

### `ui/`

UI 线程承担两类职责：

1. **输入编排**
   - `Board` 持有唯一的 `DevicesDAG`
   - `Viewport` 只做代理挂载入口，不持有自己的第二棵 DAG
   - devices / prefixes / tools 全部运行在主线程
2. **显示与交互表层**
   - `Viewport` 管理 DOM canvas、坐标换算、Worker 消息
   - `UiRenderer` 负责 overlay

UI 线程不会成为对象与区块的真实权威，只保留交互态镜像与轻量条目。

### `worker/`

Worker 是当前 Core 数据与渲染的权威侧：

- `BoardCore` 维护对象、区块、AOM、UndoTree 与持久化协调
- `ViewportCore` 维护视口区块缓冲、base/live renderer 与帧输出
- `ActiveObjectManager` 只在 Worker 中存在
- `worker/components/renderer/` 只在 Worker 中绘制 `OffscreenCanvas`

Worker 不解析 DOM 事件，也不持有 DevicesDAG。

### `shared/` 与 `utils/`

这两层是当前稳定的纯逻辑复用层：

- 不依赖 DOM
- 不要求 WorkerGlobalScope
- 可在 Jest / Node 环境直接 import

尤其要注意：

- 共享 renderer 位于 `shared/renderer/`
- Worker 专用 renderer 位于 `worker/components/renderer/`
- 对象与 range 已经收敛到 `shared/` 下，而不是旧的顶层 `objects/` / `range/`

## 当前数据权威关系

### 对象与区块

- **Worker 侧 `BoardCore`** 是对象、区块与提交关系的真实权威
- **UI 侧 tools** 通过 `BoardApiRpc` 调用 Worker RPC
- creator `_entry`、chooser / modifier 的轻量对象条目只用于交互，不是最终权威数据源

### 视口与渲染

- **Worker 侧 `ViewportCore`** 负责 base/live 两层真实补绘与 `render-frame` 输出
- **UI 侧 `Viewport`** 负责接收 `liveBitmap` 并绘制到显示 canvas
- **UI 侧 `UiRenderer`** 单独维护 overlay

### objectId 分配

- `Board.allocateObjectId()` 在 UI 侧通过本地 `CounterPool` 同步分配
- Worker 侧 `createObject` 要求显式传入 `props.id`
- Worker 若收到重复 id，会抛错并通过 RPC 返回错误

## 输入边界

当前输入链路严格停留在 UI 线程：

1. 宿主决定输入归属的 viewport 与设备路径
2. 宿主发出 `board.signalsEventBus.emit("input", { to, signals })`
3. `Board.devicesDAG.dispatch()` 处理后续路由
4. 设备、prefix、tool 全部在 UI 线程消费这条链路
5. 只有真正的数据读写才跨到 Worker

这意味着：

- Worker 不直接接收 DOM 事件
- Worker 不参与设备图路由
- tool 的副作用边界主要是 RPC 与 `Viewport` 方法调用

## 持久化边界

当前持久化边界要分成“协议层”与“默认运行时”两部分理解。

### 已存在的协议层

- `persistence-adapter.js` 定义了 `BoardCore` 依赖的持久化接口
- `file-operate-bridge-*` 定义了宿主文件 I/O bridge 协议
- `rootPath`、`memoryMode()`、`isPersistent()` 等能力已经存在于 `BoardCore`

### 当前默认运行时

- `CoreWorkerRuntime.createBoard()` 当前默认注入的是 `createDefaultPersistenceAdapter()`
- 默认 demo 主要运行在内存模式
- `undo` / `redo` 尚未接通到持久化历史路径

因此，文档中凡是涉及“文件模式已完全接通”的说法，都应理解为**目标边界或局部实现**，而不是所有运行场景下的默认事实。

## 当前默认运行模式

当前模板页的默认流程是：

1. UI 线程创建 `Worker(new URL("../core/worker/core-worker.js", import.meta.url))`
2. `Board.enableWorkerMode(worker)` 初始化 `BoardApiRpc` 与 Worker 侧 `BoardCore`
3. `Board.createViewport(...)` 创建 UI 侧 `Viewport`
4. `BoardApiRpc.createViewport(...)` 创建 Worker 侧 `ViewportCore`
5. tools 保持在 UI 线程，通过 RPC 与 Worker 协作

## 已知约束

- `undo` / `redo` RPC 名称已存在，但当前仍未实现
- 文件持久化协议与默认 Worker runtime 之间仍有接线空档
- `ui/frame/` 当前主要是文档层，不是活跃运行时代码目录
- 旧文档中常见的 `src/core-worker.js`、`components/orchestration/*` 等路径，已不再代表当前目录结构

## 相关文档

- [core-overview.md](./core-overview.md)
- [core-modules.md](./core-modules.md)
- [board-document.md](../ui/components/orchestration/docs/board-document.md)
- [viewport-document.md](../ui/components/orchestration/docs/viewport-document.md)
