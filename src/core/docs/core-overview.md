# HoundWhiteboard Core 总览

本文档提供 `src/core/` 当前实现的总览，重点说明 UI、Worker 与共享纯逻辑三层如何协作。

更细的路径级边界见 [core-runtime-boundaries.md](./core-runtime-boundaries.md)。

## 运行时分层

当前 Core 可以按职责分为四层：

1. **宿主层**：Tauri / 模板页面 / DOM 事件绑定 / 文件桥接宿主
2. **UI 线程层**：`src/core/ui/**` 与 `src/core/bridges/board-api.js`
3. **Core Worker 层**：`src/core/worker/**`
4. **共享纯逻辑层**：`src/core/shared/**`、`src/core/utils/**`

其中 `src/core/` 主要覆盖后 3 层。

### UI 线程层

UI 线程负责：

- `Board`：白板级 facade，持有 `DevicesDAG`、`signalsEventBus`、`Viewport` 集合
- `Viewport`：DOM canvas、overlay、坐标换算、Worker 同步
- `devices-dag/`：设备子图、prefix、tool 与输入路由
- `UiRenderer`：UI overlay 渲染
- `BoardApiRpc`：把 UI 侧读写请求转成 Worker RPC

### Worker 层

Worker 层负责真正的数据与渲染权威：

- `CoreWorkerRuntime`：`src/core/worker/core-worker.js` 中的消息入口与 RPC 调度器
- `BoardCore`：对象、区块、AOM、UndoTree、持久化协调
- `ViewportCore`：Worker 视口状态、区块缓冲、base/live 渲染输出
- `ActiveObjectManager`：交互态对象与动态层关系
- `worker/components/chunk/`：区块、加载器、区块对象管理
- `worker/components/renderer/`：`BaseRenderer`、`LiveRenderer` 与 Worker 侧脏区绘制

### 共享纯逻辑层

共享层不依赖 DOM，也不依赖 Worker 宿主：

- `shared/objects/`：对象模型、反序列化
- `shared/range/`：几何范围与相交判断
- `shared/renderer/`：渲染器基类、调度器、overlay 条目工厂
- `shared/types/`：跨线程共享类型定义
- `utils/`：数学、图结构、事件总线、路径工具、计数池

## 当前主链路

### 白板初始化

1. 宿主创建 `Worker(new URL("../core/worker/core-worker.js", import.meta.url))`
2. UI 线程创建 `Board`
3. `Board.enableWorkerMode(worker)` 创建 `BoardApiRpc`
4. `BoardApiRpc.createBoard(...)` 在 Worker 中创建 `BoardCore`
5. `Board.createViewport(...)` 创建 UI 侧 `Viewport`
6. `BoardApiRpc.createViewport(...)` 在 Worker 中创建 `ViewportCore`
7. `Viewport.startWorkerSync()` 启动 `viewport-change` 与 `request-render-flush` 循环

### 输入与工具

1. 宿主先判断输入属于哪个 viewport，并编码成 `SignalPacket`
2. 宿主调用 `board.signalsEventBus.emit("input", { to, signals })`
3. `Board` 按 `to` 中的 `viewportId` 把包送进唯一的 `Board.devicesDAG`
4. `DevicesDAG` 从 `/${viewportId}` 子树继续路由
5. 设备节点负责把宿主输入规整成稳定设备信号
6. prefix 节点负责注入参数、状态机、handoff 与局部路由
7. tool 叶子消费最终信号，并通过 `boardApi` 或 `viewport` 修改状态

### 渲染

1. tool 通过 `BoardApiRpc` 调用 `createObject` / `modifyObject` / `commitObjects` 等 RPC
2. Worker 侧 `BoardCore` / `ActiveObjectManager` 触发 render hooks
3. `ViewportCore` 失效 base/live 渲染器，并在 flush 时输出 `render-frame`
4. UI 侧 `Viewport` 接收 `liveBitmap` 并绘制到显示 canvas
5. `UiRenderer` 在 UI 线程补绘 overlay

## Core 的职责范围

### UI 侧职责

- 输入归属与路由入口
- 设备图挂载与 workflow 编排
- 视口 DOM 生命周期
- overlay 渲染
- 对 Worker API 的异步封装
- 本地 `objectId` 分配（`Board.allocateObjectId()`）

### Worker 侧职责

- 对象与区块的真实权威状态
- 命中查询与对象摘要查询
- AOM 动态层与静态图提交
- 视口区块缓冲与位图渲染
- UndoTree 运行时骨架

### 共享层职责

- 对象、范围、渲染器基类的纯逻辑复用
- Worker / UI / Node 测试之间共享的数据结构与算法
- JSDoc typedef 与协议约定

## 当前实现状态

- Worker mode 是当前主路径
- `Board` / `Viewport` / `BoardApiRpc` / `BoardCore` / `ViewportCore` 已接通
- devices / prefixes / tools 全部停留在 UI 线程
- 高频对象修改通过 `rpc-batch` 做微任务级合并发送
- `hitTest`、`queryObjects`、`queryChunkObjects` 已接到 Worker 权威状态
- `undo` / `redo` RPC 名称已预留，但当前仍是 `[todo]`
- 持久化接口与文件桥接协议已存在，但 Worker runtime 默认仍使用 `createDefaultPersistenceAdapter()`；完整文件模式应视为进行中集成能力

## 关键术语

- **SignalPacket**：输入系统里的标准信号包，形如 `{ to, signals }`
- **静态图**：区块内稳定层叠关系，保存在 `ChunkObjectManager.staticGraph`
- **动态图 / AOM**：交互态对象与临时层关系，由 `ActiveObjectManager` 维护
- **LightweightObjectEntry**：UI 工具链里传递的轻量对象协议，定义于 `shared/types/types.js`
- **render hook**：AOM / BoardCore 通知视口重绘的注入式桥

## 相关文档

- [core-modules.md](./core-modules.md)
- [core-data-model.md](./core-data-model.md)
- [core-input-flow.md](./core-input-flow.md)
- [core-runtime-boundaries.md](./core-runtime-boundaries.md)
- [core-stable-interfaces.md](./core-stable-interfaces.md)
