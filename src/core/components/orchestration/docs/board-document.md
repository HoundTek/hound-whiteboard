# 白板类文档

本文档提供 `Board` 的概述。

## 概述

`Board` 是 UI 线程中的白板级 façade。

它负责：

- 持有 `DevicesDAG`
- 持有 `signalsEventBus`
- 管理 `MonitorProxy` 集合
- 通过 `enableWorkerMode()` 初始化 Worker 侧 `BoardCore`，工具通过 `BoardApiRpc` 与 Worker 交互
- 为 tools 提供同步 `allocateObjectId()`

它不是 Worker 侧的真实数据权威。真正的对象、区块与 AOM 状态位于 Worker 内的 `BoardCore`。

## 运行边界

| 类            | 线程   | 职责                                                       |
| ------------- | ------ | ---------------------------------------------------------- |
| `Board`       | UI     | façade、输入分发、monitor 管理、Worker 侧 BoardCore 初始化 |
| `BoardCore`   | Worker | 对象、区块、AOM、UndoTree、持久化协调                      |
| `BoardApiRpc` | UI     | RPC 客户端，通过 postMessage 与 Worker 侧 BoardCore 通信   |

## 当前职责

### 输入总线

`Board.signalsEventBus` 当前处理三类事件：

- `input`：把输入信号送到 `devicesDAG.dispatch()`
- `mount`：把 workflow / prefix / subDAG 挂到设备图上
- `umount`：从设备图卸载 workflow

### Monitor 管理

`Board.createMonitor(...)` 返回 `MonitorProxy`，需要在调用前通过 `enableWorkerMode()` 初始化 Worker。

### Core API 选择

所有工具通过 `getBoardApi()` 获取的 `BoardApiRpc` 实例与 Worker 交互。`enableWorkerMode()` 必须在创建任何 monitor 之前调用。

### objectId 分配

`Board` 当前自持一个本地 `CounterPool`：

- `allocateObjectId()` 为同步接口
- creator 在 UI 线程用它分配新对象 id
- Worker 侧 `createObject` 要求显式传入 `props.id`
- Worker 若发现重复 id，会抛错并通过 `rpc-response` 返回错误

## 核心字段

| 名称                                    | 描述                                                  |
| --------------------------------------- | ----------------------------------------------------- |
| `signalsEventBus`                       | 输入、挂载、卸载事件总线                              |
| `devicesDAG`                            | 白板级唯一设备图                                      |
| `monitors`                              | `Map<string, MonitorProxy>`                           |
| `activeObjectManager`                   | 指向本地 `BoardCore` 的 AOM 引用（compat / 测试使用） |
| `chunkLoaded` / `objectLoaded`          | 指向本地 `BoardCore` 的 compat 引用                   |
| `undoTree`                              | 指向本地 `BoardCore` 的 UndoTree 引用                 |
| `rootChunkLoader` / `chunkLoadEventBus` | 指向本地 `BoardCore` 的 compat 引用                   |
| `#boardApi`                             | `BoardApiRpc` 实例                                    |
| `#boardCore`                            | 本地 `BoardCore` 实例                                 |
| `#counterPool`                          | UI 侧 objectId 分配器                                 |

## `enableWorkerMode()` 初始化

`enableWorkerMode(worker, options)` 的流程：

1. 确认当前还没有 monitor 被创建
2. 创建 `BoardApiRpc`
3. 等待 Worker 侧 `ready`
4. 调用 `boardApi.createBoard({ width, height, rootPath })`
5. 将内部 `#boardApi` 设为 `BoardApiRpc`

此后：

- tools 的读写都走 RPC
- `createMonitor()` 返回 `MonitorProxy`

## `createMonitor()` 语义

`createMonitor(rootElement, { width, height }, monitorId)`：

- 创建 `MonitorProxy`
- 同时调用 `boardApi.createMonitor({ monitorId, width, height })`
- `MonitorProxy.startWorkerSync()` 驱动视口同步与渲染帧回流

## 兼容接口

`Board` 仍保留若干 compat 入口：

- `getObjectById()`
- `getChunkById()`
- `createChunkLoader()`
- `activeObjectManager` / `chunkLoaded` / `objectLoaded`

tools 应优先通过 `boardApi` 访问真实状态。

## 当前状态

- `Board` 已稳定作为 UI façade
- demo 默认调用 `enableWorkerMode()`
- `createMonitor()` 走 `MonitorProxy`
- objectId 由 `Board` 自身分配，不依赖 `BoardCore`
- Worker 侧重复 id 创建会报错

## 相关文档

- [monitor-document.md](./monitor-document.md)
- [active-object-manager-document.md](./active-object-manager-document.md)
- [components-document.md](../../docs/components-document.md)
- [core-runtime-boundaries.md](../../../docs/core-runtime-boundaries.md)
