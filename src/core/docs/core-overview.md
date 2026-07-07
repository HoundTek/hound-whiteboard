# HoundWhiteboard Core 总览

本文档提供 `src/core/` 当前架构的总览。

## 运行时分层

当前应用可分为四层：

1. **宿主层**：Tauri shell 与 `src-tauri/` 后端
2. **UI 线程层**：模板、DOM canvas、输入设备、DevicesDAG、tools、Viewport
3. **Core Worker 层**：`src/core-worker.js`、BoardCore、ViewportCore、AOM、渲染器
4. **共享纯模块层**：objects / range / utils / chunk / renderer / hit / shared

`src/core/` 主要覆盖后 3 层，其中：

- UI 线程侧保留设备图、工具编排与 overlay
- Worker 侧承载对象、区块、AOM 与 base/live 渲染
- Shared 层为两边提供统一的数据结构与算法

更细的运行边界见 [core-runtime-boundaries.md](./core-runtime-boundaries.md)。

## 当前主链路

### 白板初始化

1. UI 线程创建 `Board`
2. `Board.enableWorkerMode(worker)` 初始化 `BoardApiRpc`
3. `BoardApiRpc.createBoard(...)` 在 Worker 中创建真正的 `BoardCore`
4. `Board.createViewport(...)` 返回 `Viewport`
5. `Viewport` 通过 `createViewport` RPC 在 Worker 中创建 `ViewportCore`

### 输入与工具

1. 宿主输入先归属到某个 viewport
2. `Board.signalsEventBus.emit("input", ...)` 把信号送到 `Board.devicesDAG`
3. `devices/` 节点做输入规整与分流
4. `prefixs/` 负责 handoff、信号转换和局部状态机
5. `tools/` 作为叶子消费信号，并通过 `boardApi` 读写 Worker 状态

### 渲染

1. Worker 侧 `BoardCore` / `AOM` / renderHooks 触发 `ViewportCore` 的 base/live 补绘
2. `ViewportCore.flushRenderFrame()` 输出 `render-frame`
3. UI 侧 `Viewport` 接收位图并合成到 DOM canvas
4. `UiRenderer` 在 UI 线程独立绘制 overlay

## Core 的职责范围

### Worker 侧核心职责

- `BoardCore`：对象注册表、区块加载状态、AOM、UndoTree、持久化协调
- `ViewportCore`：Worker 视口状态、ChunkLoader、OffscreenCanvas 渲染
- `BoardCore`（通过 RPC 暴露）：create / modify / commit / query / hitTest 等核心操作实现

### UI 侧核心职责

- `Board`：UI facade，持有 signalsEventBus、DevicesDAG、viewport 集合，通过 Worker 与 BoardCore 通信
- `Viewport`：UI 视口，承载 DOM canvas 与 overlay，接收 Worker 侧渲染帧
- `devices-dag/`（含 `devices/`、`tools/`、`prefixs/`）：输入编排与交互工具
- `UiRenderer`：UI overlay 渲染

### 共享职责

- `objects/`：对象模型与反序列化
- `range/`：几何范围抽象与碰撞判定
- `utils/`：数学、图结构、事件总线等基础设施
- `chunk/`：区块、覆盖索引与加载器
- `renderer/`：base/live 渲染器与调度器
- `hit/`：Undo Tree 核心结构（Worker 侧）
- `shared/`：跨线程共享类型定义

## 当前实现状态

- `BoardCore` / `ViewportCore` / `Viewport` / `BoardApiRpc` 已全部接通
- demo 默认启用 Worker mode
- creator / chooser / modifier 已全部适配 Worker mode
- creator 本地状态使用 `_entry` 纯数据对象（遵循 `LightweightObjectEntry` 协议）
- objectId 在 UI 侧由 `Board` 自持 `CounterPool` 同步分配，Worker 侧要求显式传入 id
- Worker 若收到重复 objectId，会通过 RPC 抛错返回

## 关键术语

- **RPC 通信**：UI 侧 `BoardApiRpc` 通过 postMessage 与 Worker 侧 `BoardCore` 通信，viewport 通过 `Viewport` ↔ `ViewportCore` 协作
- **静态图**：各 `ChunkObjectManager.staticGraph` 维护的稳定层叠关系
- **动态图 / AOM**：`ActiveObjectManager` 维护的交互态对象与临时层关系

## 相关文档

- [core-modules.md](./core-modules.md)
- [core-data-model.md](./core-data-model.md)
- [core-input-flow.md](./core-input-flow.md)
- [core-runtime-boundaries.md](./core-runtime-boundaries.md)
