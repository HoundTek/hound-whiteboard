# 区块对象管理器文档

本文档提供 `ChunkObjectManager` 的概述。

`ChunkObjectManager` 负责管理单区块内的静态图与覆盖区块索引，是 Worker 侧区块关系数据维护的核心组件。

## 概述

当前 `ChunkObjectManager` 的核心职责有三类：

1. 维护区块静态层叠图 `staticGraph`
2. 维护对象覆盖区块索引的读写语义
3. 通过 `board` 间接访问对象实例与对象加载/保存能力

它不拥有对象实例本身；对象实例的权威注册表位于 `BoardCore.objectLoaded`。

## 核心字段

| 名称                | 描述                                       | 类型                                    |
| ------------------- | ------------------------------------------ | --------------------------------------- |
| `staticGraph`       | 区块静态层叠图，仅存对象 id 与层关系       | `DirectedGraph`                         |
| `board`             | 所属白板引用；当前主路径通常是 `BoardCore` | `BoardCore \| Board \| undefined`       |
| `id`                | 当前区块 id                                | `number`                                |
| `#localCoverChunks` | 无 `board` 时的本地覆盖索引回退，仅测试用  | `Map<number, Set<number>> \| undefined` |

## 对象覆盖索引模型

### 当前权威位置

当前覆盖区块索引的权威副本集中在 `BoardCore.#objectCoverChunks`。

因此：

- `ChunkObjectManager` 在有 `board.getObjectCoverChunks()` / `setObjectCoverChunks()` 时，会委托给 `BoardCore`
- 只有在无 `board` 的局部测试场景下，才会回退到本地 `#localCoverChunks`

### 覆盖索引的用途

这份索引不仅用于持久化，也用于运行时行为：

- 对象创建后建立覆盖区块索引
- 对象几何变化后刷新覆盖区块索引
- AOM 在跨区块拾取与提交时读取这份索引

如果索引落后于对象真实几何，跨区块操作就会读到旧范围。

## 核心接口

### 对象实例访问

- `getObject(objectId)`：通过 `board.getObjectById(...)` 间接获取对象实例

当前运行时中，这里的 `board` 主要指向 Worker 侧 `BoardCore`。

### 覆盖索引接口

- `setObjectCoverChunks(objectId, chunkIds)`
- `getObjectCoverChunks(objectId)`
- `unsetObjectCoverChunks(objectId)`
- `serializeObjectCoverChunks()`
- `loadObjectCoverChunksFromData(coverIndexData)`

### 覆盖范围重算

- `syncObjectCoverChunksForObject(obj, chunkWidth, chunkHeight)`
- `syncAllObjectCoverChunks(chunkWidth, chunkHeight)`
- `calculateCoveredChunkIdsForRange(worldRange, chunkWidth, chunkHeight)`（静态方法）

当前算法会：

1. 从对象主判定范围 `obj.getRange()` 得到世界范围
2. 计算候选区块边界框
3. 逐区块做 range 相交判断
4. 生成覆盖区块 id 集合

## 区块元数据读写

### `loadChunkMetadata(boardRootPath)`

当前会读取：

```text
chunks/{chunkId}.json
```

并恢复两部分内容：

- `tierGraph`
- `objectCoverIndex`

### `saveChunkMetadata(boardRootPath)`

当前会把：

- `staticGraph.toArray()`
- `serializeObjectCoverChunks()`

写回同一个 `chunks/{chunkId}.json`。

### 重要说明

当前代码**不会**把覆盖索引单独写成 `{chunkId}-object-cover.json`。

## 对象读写接口

- `loadObjects(boardRootPath)`：委托 `board.loadChunkObjectEntries(...)`
- `saveObjects(boardRootPath)`：委托 `board.saveChunkObjectEntries(...)`
- `unloadObjects()`：委托 `board.unloadChunkObjectEntries(...)`
- `unload()`：统一卸载层叠图与对象相关数据

## 与其它组件的关系

- 被 [chunk-document.md](./chunk-document.md) 持有
- 与 [board-core-document.md](../../orchestration/docs/board-core-document.md) 一起维护对象与区块关系
- 会被 [active-object-manager-document.md](../../orchestration/docs/active-object-manager-document.md) 的跨区块逻辑间接依赖
- 底层图结构依赖 `src/core/utils/directed-graph.js`

## 当前实现状态

- 已实现：静态图管理、覆盖区块索引管理、区块元数据加载/保存、通过 `board` 间接获取对象实例、基于 `Range` 的覆盖区块计算
- 已接线：对象创建/提交路径上的覆盖索引同步、AOM 跨区块操作读取覆盖索引
- 需诚实说明：区块元数据读写当前仍直接调用 `boardFileOperateBridge`，尚未完全统一到纯 `persistenceAdapter` 路径

## 相关文档

- [chunk-document.md](./chunk-document.md)
- [board-core-document.md](../../orchestration/docs/board-core-document.md)
- [file-operate-document.md](../../../../bridges/docs/file-operate-document.md)
