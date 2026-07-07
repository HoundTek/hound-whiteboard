# 组件文件操作文档

本文档整理 Core 层涉及文件系统读写的实现边界（相关模块当前位于 `core/shared/`、`core/ui/`、`core/worker/`）。

## 概述

当前文件 I/O 通过两层抽象完成：

1. `persistenceAdapter`：Core 侧持有的持久化接口
2. host bridge：UI / preload / Tauri 宿主负责的真实文件访问实现

这意味着：

- `BoardCore` / `ChunkObjectManager` 只依赖持久化接口，不直接依赖宿主 API
- UI 线程在启用文件模式时，为 `BoardCore` 注入 `createRendererPersistenceAdapter(rootPath, bridge)`
- Worker / UI 的运行边界不会改变持久化语义本身

## 当前涉及的组件

- `Board`：选择并注入持久化适配器
- `BoardCore`：通过 `persistenceAdapter` 协调对象与区块元数据读写
- `ChunkObjectManager`：读写区块静态图与对象覆盖区块索引

## 持久化模式

### `filesystem`

- 传入有效 `rootPath`
- `Board` 为 `BoardCore` 注入 renderer/host 持久化适配器
- 区块层叠图、对象条目、覆盖区块索引可以落到文件系统

### `memory`

- 没有有效 `rootPath`
- `BoardCore` 使用默认内存适配器
- 不访问真实文件系统

## 当前稳定文件语义

### 区块层叠图

- 路径：`chunks/{chunkId}.json`
- 内容：`staticGraph` 的数组化结果

### 覆盖区块索引

- 路径：`chunks/{chunkId}-object-cover.json`
- 内容：`Array<[objectId, number[]]>`

### 对象条目

- 路径：`objects/chunk{ownerChunkId}/{objectId}.json`
- 内容：对象序列化结果
- 关键字段：`ownerChunkId`

## 当前实现边界

### `Board`

`Board` 的职责不是直接操作文件，而是：

- 解析 `rootPath`
- 决定 `filesystem` / `memory` 模式
- 构造 `BoardCore`
- 注入合适的 `persistenceAdapter`

### `BoardCore`

`BoardCore` 负责：

- 读取区块静态图
- 读取对象条目
- 协调区块加载 / 卸载与对象注册表
- 调用适配器完成保存与删除

### `ChunkObjectManager`

`ChunkObjectManager` 负责：

- 区块静态图的读写
- 覆盖区块索引的读写

## 运行说明

当前架构下：

- 真实 `BoardCore` 位于 Worker
- 文件访问仍经由注入的持久化适配器完成
- `BoardApiRpc` 只负责对象 / 区块语义读写，不直接承担文件桥语义

当前默认 demo 主要运行在内存模式；完整文件模式属于宿主集成路径。

## 已知约束

- `.hwb` 历史结构与快照恢复仍有后续完善空间
- objectId 计数池恢复未从持久化层接通
- 更复杂的并发写入与原子替换策略仍属于后续优化范围

## 相关文档

- [board-document.md](../orchestration/docs/board-document.md)
- [chunk-object-manager-document.md](../chunk/docs/chunk-object-manager-document.md)
- [file-structure.md](../../docs/file-structure.md)
