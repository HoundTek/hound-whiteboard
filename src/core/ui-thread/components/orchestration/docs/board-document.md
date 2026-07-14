# Board 文档

本文档提供 `Board`（UI 侧白板 facade）的概述。

Worker 侧真实白板核心参见 [board-core-document.md](../../../../engine/orchestration/docs/board-core-document.md)。

## 概述

`Board` 是 UI 线程中的白板级 facade。它负责：

- 持有白板级唯一 `DevicesDAG`
- 持有 `signalsEventBus`
- 管理 `Viewport` 集合
- 初始化 `BoardApiRpc`
- 将 `rootPath`、板面尺寸等信息传递给 Worker 侧 `BoardCore`
- 为创建类工具同步分配 `objectId`

`Board` 本身**不持有本地 `BoardCore` 实例**。Worker 侧状态通过 RPC 访问。

## 当前职责

### 输入总线

`Board.signalsEventBus` 当前处理一类事件：

- `input`：把输入包送到 `devicesDAG.dispatch()`

### Viewport 管理

`Board.createViewport(...)`：

- 创建 UI 侧 `Viewport`
- 把 viewport 注册到 `Board.viewports`
- 为 `/${viewportId}` 节点补充 viewport 上下文
- 异步调用 `boardApi.createViewport(...)` 在 Worker 中创建 `ViewportCore`

### Worker mode 初始化

`enableWorkerMode(worker, options)`：

1. 确认当前还没有创建任何 viewport
2. 创建 `BoardApiRpc`
3. 等待 Worker 发送 `ready`
4. 调用 `boardApi.createBoard({ width, height, rootPath })`
5. 缓存 `#boardApi` 与 `#worker`

### objectId 分配

`Board` 自持本地 `CounterPool`。

- `allocateObjectId()` 是同步接口
- creator 在 UI 线程调用它分配新对象 id
- Worker 侧 `createObject` 要求显式传入 `props.id`
- 若 id 重复，Worker 会通过 RPC 报错

## 核心字段

| 名称               | 描述                                  |
| ------------------ | ------------------------------------- |
| `width` / `height` | 白板宽高，同时也是当前 chunk 尺寸来源 |
| `rootPath`         | 白板根路径；为空时通常意味着内存模式  |
| `viewports`        | `Map<string, Viewport>`               |
| `signalsEventBus`  | 输入事件总线                          |
| `devicesDAG`       | 白板级唯一设备图                      |
| `#boardApi`        | `BoardApiRpc` 实例                    |
| `#worker`          | 当前绑定的 Worker 端点                |
| `#counterPool`     | UI 侧 `objectId` 分配器               |

## `createViewport()` 语义

`createViewport(rootElement, { width, height }, viewportId)` 会：

1. 检查 Worker mode 已启用
2. 创建 viewport 相关 DOM 节点
3. 构造 UI 侧 `Viewport`
4. 注册到 `Board.viewports`
5. 用 `devicesDAG.configureNode(viewportId, ...)` 为 viewport 根节点补充 `viewport` 上下文
6. 异步创建 Worker 侧 `ViewportCore`
7. 在成功后调用 `viewport.startWorkerSync()`

## workflow 挂载约定

workflow 通过 `viewport.mountWorkflow(name, workflow, edges)` 挂到：

```text
/<viewportId>/workflows/${name}
```

再通过 `edges` 把设备节点接到这个 workflow。

这是一条 **Board 层约定**，而不是 `DevicesDAG` 的硬性限制。

## 当前状态

- `Board` 是 UI facade，不缓存本地 `BoardCore`
- demo 默认走 `enableWorkerMode()` 路径
- `createViewport()` 创建 UI 侧 `Viewport`，Worker 侧则创建 `ViewportCore`
- `objectId` 由 `Board` 自身分配

## 设计约束

- `enableWorkerMode()` 必须在创建任何 viewport 之前调用
- `Board` 不负责对象、区块、AOM 的真实权威状态
- UI 工具应优先通过 `getBoardApi()` 获取的 `BoardApiRpc` 访问 Worker 数据

## 相关文档

- [viewport-document.md](./viewport-document.md)
- [board-api-rpc-document.md](../../../../bridges/docs/board-api-rpc-document.md)
- [core-runtime-boundaries.md](../../../../docs/core-runtime-boundaries.md)
