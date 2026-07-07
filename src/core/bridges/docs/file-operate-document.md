# 组件文件操作文档

本文档整理 Core 层与文件系统读写相关的当前实现边界。

## 概述

当前文件 I/O 相关代码分成三层：

1. **持久化接口层**：`persistenceAdapter`
2. **Core 运行时层**：`BoardCore`、`ChunkObjectManager`
3. **宿主桥接层**：`file-operate-bridge-renderer.js` / `file-operate-bridge-main.js`

需要特别说明：

- 顶层协议已经存在
- 但默认 Worker runtime 仍主要运行在内存模式
- 因此这里描述的是**当前文件模式合同**，不是所有运行场景默认都已接通的能力

## 当前涉及的组件

### `persistence-adapter.js`

职责：

- 定义 `BoardCore` 使用的持久化接口
- 提供 `createDefaultPersistenceAdapter()`
- 提供 `createRendererPersistenceAdapter(rootPath, fileBridge)`

接口面主要包括：

- `loadChunkMetadata(chunkId)`
- `saveChunkMetadata(chunkId, metadata)`
- `loadObjects(objectIds)`
- `saveObjects(objects)`
- `deleteObject(objectId)`

### `BoardCore`

`BoardCore` 负责：

- 表达对象与区块的持久化需求
- 通过 `persistenceAdapter` 加载/保存对象数据
- 协调区块加载与对象注册表同步

### `ChunkObjectManager`

`ChunkObjectManager` 负责：

- 维护区块静态图 `staticGraph`
- 维护区块级覆盖索引读写语义
- 加载/保存 `chunks/{chunkId}.json` 中的元数据

当前需要诚实说明的一点是：

- `ChunkObjectManager` 的区块元数据读写目前仍直接调用 `boardFileOperateBridge`
- 这说明“完全只经由 `persistenceAdapter` 解耦”的目标还没有在所有路径上彻底落地

### `file-operate-bridge-renderer.js` / `file-operate-bridge-main.js`

职责：

- renderer 侧发起文件操作请求
- host / main 侧执行真实文件系统读写
- 约定 `.hwb` 目录结构与读写动作

## 当前持久化模式

### `memory`

- 未提供有效 `rootPath`
- `BoardCore.memoryMode()` 返回 `true`
- 默认 Worker runtime 当前主要走这条路径
- 不访问真实文件系统

### `filesystem`

- 提供有效 `rootPath`
- 代码层已定义文件桥与持久化接口
- 但是否真正接通，要看具体运行时是否注入了文件模式能力

当前默认 `CoreWorkerRuntime.createBoard()` 仍注入 `createDefaultPersistenceAdapter()`，所以不要把“文件模式默认已接通”写成既成事实。

## 当前稳定文件语义

### 区块元数据

主路径：

```text
chunks/{chunkId}.json
```

当前主结构：

```json
{
  "tierGraph": [],
  "objectCoverIndex": []
}
```

含义：

- `tierGraph`：区块静态层叠图
- `objectCoverIndex`：对象覆盖区块索引

当前代码**不会**再把覆盖索引单独存成 `{chunkId}-object-cover.json`。

### 对象条目

当前主路径：

```text
objects/{objectId}.json
```

当前 bridge 采用的是**扁平对象存储**，而不是旧文档中的：

```text
objects/chunk{ownerChunkId}/{objectId}.json
```

### 目录创建与后续文件

执行 `createBoardRoot()` 后，当前确定会创建：

```text
.hwb/
  meta.json
  config.json
  devices/
  history/
  objects/
  chunks/
  templates/
```

后续文件模式运行中，还会继续读写：

- `trace.json`
- `chunks/connection.json`
- `chunks/{chunkId}.json`
- `objects/{objectId}.json`

## 当前实现边界

### `Board`

`Board` 当前的职责不是直接注入文件桥，而是：

- 持有 `rootPath`
- 通过 `enableWorkerMode()` 把 `width` / `height` / `rootPath` 传给 Worker
- 为 UI 工具提供 `BoardApiRpc`

因此不要把当前默认运行时写成“`Board` 已为 `BoardCore` 注入 renderer 持久化适配器”。这更接近目标架构，而不是所有场景下的默认事实。

### `BoardCore`

`BoardCore` 负责：

- 加载对象实例
- 保存对象实例
- 删除对象实例
- 根据区块加载状态同步对象注册表

### `ChunkObjectManager`

`ChunkObjectManager` 负责：

- 加载/保存区块元数据
- 解析 `tierGraph`
- 恢复 `objectCoverIndex`

## 已知约束

- 默认 Worker runtime 仍主要运行在内存模式
- `undo` / `redo` 与 `history/` 的真实落盘语义尚未实现
- `ownerChunkId` 不能再被写成“所有对象 JSON 的稳定必备字段”
- 对象计数池恢复尚未从持久化层接回 UI 侧 `CounterPool`
- `ChunkObjectManager` 的元数据读写仍保留对 `boardFileOperateBridge` 的直接依赖

## 相关文档

- [file-structure.md](../../docs/file-structure.md)
- [board-core-document.md](../../worker/components/orchestration/docs/board-core-document.md)
- [chunk-object-manager-document.md](../../worker/components/chunk/docs/chunk-object-manager-document.md)
