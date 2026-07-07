# Board 文档

本文档提供 `Board`（UI 侧白板 facade）的概述。Worker 侧 `BoardCore` 参见 [board-core-document.md](../../../../worker/components/orchestration/docs/board-core-document.md)。

## 概述

`Board` 是 UI 线程中的白板级 facade。它负责：

- 持有 `DevicesDAG`
- 持有 `signalsEventBus`
- 管理 `Viewport` 集合
- 通过 `enableWorkerMode()` 初始化 Worker 侧 `BoardCore`
- 为 tools 提供同步 `allocateObjectId()`

## 当前职责

### 输入总线

`Board.signalsEventBus` 当前处理三类事件：

- `input`：把输入信号送到 `devicesDAG.dispatch()`
- `mount`：把 workflow / prefix / subDAG 挂到设备图上
- `umount`：从设备图卸载 workflow

### Viewport 管理

`Board.createViewport(...)` 返回 `Viewport`，需要在调用前通过 `enableWorkerMode()` 初始化 Worker。

### Core API 选择

所有工具通过 `getBoardApi()` 获取的 `BoardApiRpc` 实例与 Worker 交互。`enableWorkerMode()` 必须在创建任何 viewport 之前调用。

### objectId 分配

`Board` 自持一个本地 `CounterPool`，`allocateObjectId()` 为同步接口。creator 在 UI 线程用它分配新对象 id，Worker 侧 `createObject` 要求显式传入 `props.id` 且会校验重复。

## 核心字段

| 名称              | 描述                                                |
| ----------------- | --------------------------------------------------- |
| `signalsEventBus` | 输入、挂载、卸载事件总线                            |
| `devicesDAG`      | 白板级唯一设备图                                    |
| `viewports`       | `Map<string, Viewport>`                             |
| `#boardApi`       | `BoardApiRpc` 实例                                  |
| `#boardCore`      | 本地 `BoardCore` 实例（Worker 侧状态通过 RPC 访问） |
| `#counterPool`    | UI 侧 objectId 分配器                               |

## `enableWorkerMode()` 初始化

`enableWorkerMode(worker, options)` 的流程：

1. 确认当前还没有 viewport 被创建
2. 创建 `BoardApiRpc`
3. 等待 Worker 侧 `ready`
4. 调用 `boardApi.createBoard({ width, height, rootPath })`
5. 将内部 `#boardApi` 设为 `BoardApiRpc`

此后：

- tools 的读写都走 RPC
- `createViewport()` 返回 `Viewport`

## `createViewport()` 语义

`createViewport(rootElement, { width, height }, viewportId)`：

- 创建 `Viewport`
- 同时调用 `boardApi.createViewport({ viewportId, width, height })`
- `Viewport.startWorkerSync()` 驱动视口同步与渲染帧回流

## 兼容接口

`Board` 仍保留若干 compat 入口：

- `getObjectById()`
- `getChunkById()`
- `createChunkLoader()`
- `activeObjectManager` / `chunkLoaded` / `objectLoaded`

tools 应优先通过 `boardApi` 访问真实状态。

## 当前状态

- `Board` 作为 UI facade
- demo 默认调用 `enableWorkerMode()`
- `createViewport()` 走 `Viewport`
- objectId 由 `Board` 自身分配

## 相关文档

- [viewport-document.md](./viewport-document.md)
- [active-object-manager-document.md](../../../../worker/components/orchestration/docs/active-object-manager-document.md)
- [core-runtime-boundaries.md](../../../../docs/core-runtime-boundaries.md)
