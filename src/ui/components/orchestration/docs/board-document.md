# Board 文档

本文档提供 `Board`（UI 侧白板 facade）的概述。

Worker 侧真实白板核心参见 [board-core-document.md](../../../../kernel/board/docs/board-core-document.md)。

## 概述

`Board` 是 UI 线程中的白板级 facade。它负责：

- 持有白板级唯一 `DevicesDAG`
- 持有 `signalsEventBus`
- 管理 `Viewport` 集合
- 初始化 `BoardApiRpc`
- 将 `rootPath`、板面尺寸等信息传递给 Worker 侧 `BoardCore`
- 为创建类工具同步分配 `objectId`

`Board` 本身**不持有本地 `BoardCore` 实例**。Worker 侧状态通过 RPC 访问。

demo 默认走 `enableWorkerMode()` 路径。

## 当前职责

### 输入总线

`Board.signalsEventBus` 当前处理一类事件：

- `input`：把输入包送到 `devicesDAG.dispatch()`

### Worker mode 初始化

`enableWorkerMode(worker, options)`：

1. 确认当前还没有创建任何 viewport
2. 创建 `BoardApiRpc`
3. 挂接 io-invoke-forwarder（worker 内驱动的文件操作经主线程转发到 Tauri invoke）
4. 等待 Worker 发送 `ready`（超时可经 `options.readyTimeoutMs` 覆盖，回退到 `options.timeoutMs`）
5. 调用 `boardApi.createBoard({ width, height, rootPath, source, syncUrl, boardId })`（超时可经 `options.createBoardTimeoutMs` 覆盖，默认 20s——持久化首开含 daemon 拉起，Rust 侧就绪轮询上限 15s）
6. 续种对象 id 池（见下文「objectId 分配」）
7. 缓存 `#boardApi` 与 `#worker`

### objectId 分配

`Board` 自持 `#idPool`（`IncrementalIdPool`，分配 `idSource` 命名空间的字符串 id，形如 `{source}/{n}`）。

- `allocateObjectId()` 是同步接口；分配即 `reportObjectIdCounter` 上报，计数随板元数据持久化
- `enableWorkerMode` 后按 `getObjectIdCounters` 续种，重开不发生分配碰撞
- creator 在 UI 线程调用它分配新对象 id
- Worker 侧 `createObject` 要求显式传入 `props.id`
- 若 id 重复，Worker 会通过 RPC 报错

## 核心字段

| 名称               | 描述                                                         |
| ------------------ | ------------------------------------------------------------ |
| `width` / `height` | 白板宽高，同时也是当前 chunk 尺寸来源                        |
| `rootPath`         | 白板根路径；为空时通常意味着内存模式                         |
| `viewports`        | `Map<string, Viewport>`                                      |
| `signalsEventBus`  | 输入事件总线                                                 |
| `devicesDAG`       | 白板级唯一设备图                                             |
| `#boardApi`        | `BoardApiRpc` 实例                                           |
| `#worker`          | 当前绑定的 Worker 端点                                       |
| `#idPool`          | UI 侧 `objectId` 分配器（`IncrementalIdPool`）               |
| `sharedState`      | 共享状态 store（DAG 内经 `services.sharedState` 注入）       |
| `syncUrl`          | 同步中继地址（可选）                                         |
| `boardId`          | 板标识（可选，同步用）                                       |

## `createViewport()` 语义

`createViewport(rootElement, { width, height }, viewportId)` 会：

1. 检查 Worker mode 已启用
2. 创建 viewport 相关 DOM 节点
3. 构造 UI 侧 `Viewport`
4. 注册到 `Board.viewports`
5. 用 `devicesDAG.configureNode(viewportId, ...)` 为 `/${viewportId}` 节点补充 `viewport` 上下文
6. 异步创建 Worker 侧 `ViewportCore`
7. 在成功后调用 `viewport.startWorkerSync()`

## workflow 挂载约定

workflow 通过 `viewport.inputScope.mountWorkflow(name, workflow)` 挂到：

```text
/<viewportId>/workflows/${name}
```

再经 `viewport.inputScope.addEdge({ from, to })` 把设备节点接到这个 workflow。

这是一条 **Board 层约定**，而不是 `DevicesDAG` 的硬性限制。

## 设计约束

- `enableWorkerMode()` 必须在创建任何 viewport 之前调用
- `Board` 不负责对象、区块、AOM 的真实权威状态
- UI 工具应优先通过 `getBoardApi()` 获取的 `BoardApiRpc` 访问 Worker 数据

## 相关文档

- [viewport-document.md](./viewport-document.md)
- [board-api-rpc-document.md](../../../../host/bridges/docs/board-api-rpc-document.md)
- [core-runtime-boundaries.md](../../../../docs/core-runtime-boundaries.md)
