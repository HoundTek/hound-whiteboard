# 白板类文档

本文档提供 `Board` 的概述。

## 概述

`Board` 是 UI 线程中的白板级 façade。

它负责：

- 持有 `DevicesDAG`
- 持有 `signalsEventBus`
- 管理 `Monitor` / `MonitorProxy` 集合
- 负责 same-thread / Worker mode 的切换
- 为 tools 提供同步 `allocateObjectId()`
- 把 Core 数据操作委托给 `BoardApi` 或 `BoardApiRpc`

它不是 Worker 侧的真实数据权威。Worker 模式下，真正的对象、区块与 AOM 状态位于 Worker 内的 `BoardCore`。

## 运行边界

| 类            | 线程                                    | 职责                                            |
| ------------- | --------------------------------------- | ----------------------------------------------- |
| `Board`       | UI                                      | façade、输入分发、monitor 管理、Worker 模式切换 |
| `BoardCore`   | Worker（same-thread compat 时本地复用） | 对象、区块、AOM、UndoTree、持久化协调           |
| `BoardApi`    | same-thread / Worker                    | Core 语义真实实现                               |
| `BoardApiRpc` | UI                                      | RPC 客户端                                      |

## 当前职责

### 输入总线

`Board.signalsEventBus` 当前处理三类事件：

- `input`：把输入信号送到 `devicesDAG.dispatch()`
- `mount`：把 workflow / prefix / subDAG 挂到设备图上
- `umount`：从设备图卸载 workflow

### Monitor 管理

`Board.createMonitor(...)` 是 monitor 家族的统一入口：

- same-thread 模式返回 `Monitor`
- Worker mode 返回 `MonitorProxy`

### Core API 选择

- 默认使用 `BoardApi`（same-thread）
- 调用 `enableWorkerMode(worker)` 后切换为 `BoardApiRpc`

### objectId 分配

`Board` 当前自持一个本地 `CounterPool`：

- `allocateObjectId()` 为同步接口
- creator 在 UI 线程用它分配新对象 id
- Worker 侧 `BoardApi.createObject(type, props)` 要求显式传入 `props.id`
- Worker 若发现重复 id，会抛错并通过 `rpc-response` 返回错误

## 核心字段

| 名称                                    | 描述                                                              |
| --------------------------------------- | ----------------------------------------------------------------- | -------------- |
| `signalsEventBus`                       | 输入、挂载、卸载事件总线                                          |
| `devicesDAG`                            | 白板级唯一设备图                                                  |
| `monitors`                              | `Map<string, Monitor                                              | MonitorProxy>` |
| `activeObjectManager`                   | 指向本地 `BoardCore` 的 AOM 引用（same-thread compat / 测试使用） |
| `chunkLoaded` / `objectLoaded`          | 指向本地 `BoardCore` 的 compat 引用                               |
| `undoTree`                              | 指向本地 `BoardCore` 的 UndoTree 引用                             |
| `rootChunkLoader` / `chunkLoadEventBus` | 指向本地 `BoardCore` 的 compat 引用                               |
| `#boardApi`                             | `BoardApi` 或 `BoardApiRpc`                                       |
| `#boardCore`                            | 本地 `BoardCore` 实例                                             |
| `#counterPool`                          | UI 侧 objectId 分配器                                             |

## Worker 模式切换

`enableWorkerMode(worker, options)` 的流程：

1. 确认当前还没有 monitor 被创建
2. 创建 `BoardApiRpc`
3. 等待 Worker 侧 `ready`
4. 调用 `boardApi.createBoard({ width, height, rootPath })`
5. 把内部 `#boardApi` 切换为 `BoardApiRpc`
6. 标记 `#useWorker = true`

此后：

- tools 的读写都走 RPC
- `createMonitor()` 走 `MonitorProxy`
- 本地 `BoardCore` 主要保留为 same-thread compat 状态与字段转发表

## `createMonitor()` 语义

`createMonitor(rootElement, { width, height }, monitorId)`：

- same-thread：创建 `Monitor`
- Worker mode：创建 `MonitorProxy`
  - 同时调用 `boardApi.createMonitor({ monitorId, width, height })`
  - `MonitorProxy.startWorkerSync()` 驱动视口同步与渲染帧回流

## 兼容接口

`Board` 仍保留若干 same-thread compat 入口：

- `getObjectById()`
- `getChunkById()`
- `createChunkLoader()`
- `activeObjectManager` / `chunkLoaded` / `objectLoaded`

这些接口在 same-thread 模式下是主路径；在 Worker mode 下应优先通过 `boardApi` 访问真实状态。

## 当前状态

- `Board` 已稳定作为 UI façade
- demo 默认调用 `enableWorkerMode()`
- `createMonitor()` 已完整支持 `MonitorProxy`
- objectId 由 `Board` 自身分配，不依赖 `BoardCore`
- Worker 侧重复 id 创建会报错

## 相关文档

- [monitor-document.md](./monitor-document.md)
- [active-object-manager-document.md](./active-object-manager-document.md)
- [components-document.md](../../docs/components-document.md)
- [core-runtime-boundaries.md](../../../docs/core-runtime-boundaries.md)
