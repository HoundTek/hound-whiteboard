# 区块类文档

本文档提供 `Chunk` 的概述。

`Chunk` 是单区块生命周期管理单元，负责维护区块 id、由 id 推导出的二维坐标，以及协调本区块对象管理器的加载与卸载。

## 核心职责

- 维护区块唯一标识 `id`
- 维护由 `id` 推导出的二维坐标 `x` / `y`
- 持有本区块的 `ChunkObjectManager`
- 提供临时加载、完整加载、降级与卸载入口
- 提供对象加入/移除静态图的基础接口

## 核心字段

| 名称                                                 | 描述                                       | 类型                              |
| ---------------------------------------------------- | ------------------------------------------ | --------------------------------- |
| `id`                                                 | 区块唯一标识                               | `number`                          |
| `x` / `y`                                            | 区块二维坐标                               | `number`                          |
| `board`                                              | 所属白板引用，当前主路径通常是 `BoardCore` | `BoardCore \| Board \| undefined` |
| `objectManager`                                      | 区块对象管理器                             | `ChunkObjectManager \| undefined` |
| `leftChunk` / `rightChunk` / `upChunk` / `downChunk` | 邻接区块引用                               | `Chunk \| undefined`              |
| `isLoad`                                             | 当前是否已加载                             | `boolean`                         |
| `isTempLoad`                                         | 当前是否处于临时加载状态                   | `boolean`                         |

## 区块 id 与坐标

当前实现以区块 id 作为主描述，二维坐标由 id 推导：

- `Chunk.idToCoordinate(id)`
- `Chunk.coordinateToId(x, y)`
- `Chunk.isValidChunkIdentity(id, x, y)`
- `chunk.isValid()` / `chunk.assertValid()`

约定：

- `1` 对应原点 `(0, 0)`
- 后续 id 按回字形向外扩展
- 同一坐标只对应唯一一个区块 id

## 加载模型

### 临时加载 `loadTemp(boardRootPath)`

当前会：

1. 标记 `isLoad = true`
2. 标记 `isTempLoad = true`
3. 确保存在 `ChunkObjectManager`
4. 调用 `objectManager.loadChunkMetadata(boardRootPath)`

当前临时加载的重点是：

- 让区块静态图与覆盖索引就绪
- 不主动在这里装载对象实例

### 完整加载 `loadFull(boardRootPath)`

当前实现非常轻量：

1. 若已完整加载，直接返回 `false`
2. 若尚未加载，先执行 `loadTemp(boardRootPath)`
3. 将 `isTempLoad` 置为 `false`

需要特别说明：

- `Chunk.loadFull()` 自身**不会**加载对象实例内容
- 对象实例的真正同步由更高层的 `BoardCore.syncChunkObjectEntries()` 协调

因此“完整加载”的语义是**区块状态升级入口**，不是对象读取逻辑本身。

### 从完整加载降级 `downgradeToTemp()`

当前实现只会：

- 检查当前确实处于完整加载状态
- 把 `isTempLoad` 改回 `true`

它当前**不会**直接在 `Chunk` 内部卸载对象实例；对象释放仍由更高层协调。

### 卸载 `unload()` / `unloadTemp()`

- `unload()`：释放 `objectManager`，并重置加载状态
- `unloadTemp()`：仅允许临时加载状态下调用，内部复用 `unload()`

## 对象接口

### `addObject(obj, below, above)`

会：

- 确保存在 `objectManager`
- 必要时通过 `board.registerObjectInstance(obj)` 注册对象
- 向静态图加入对象节点
- 根据 `below` / `above` 建立层叠边

### `removeObject(objectId)`

会：

- 从静态图删除该对象节点
- 删除该对象的覆盖区块索引

## API 概览

| 名称                                                | 描述                         |
| --------------------------------------------------- | ---------------------------- |
| `idToCoordinate(id)`                                | id 转二维坐标                |
| `coordinateToId(x, y)`                              | 二维坐标转 id                |
| `isValidChunkIdentity(id, x, y)`                    | 判断区块 id 与坐标是否匹配   |
| `worldToChunkId(worldPos, chunkWidth, chunkHeight)` | 世界坐标转区块 id            |
| `connectTwoChunk(first, second, direction)`         | 连接两个邻接区块             |
| `addObject(obj, below, above)`                      | 向静态图加入对象             |
| `removeObject(objectId)`                            | 从静态图移除对象             |
| `loadTemp(boardRootPath)`                           | 临时加载区块元数据           |
| `loadFull(boardRootPath)`                           | 将区块升级到完整加载状态     |
| `downgradeToTemp()`                                 | 从完整加载降级为临时加载状态 |
| `unload()`                                          | 完整卸载区块                 |
| `unloadTemp()`                                      | 卸载临时加载区块             |

## 实现状态

- 已实现：区块 id/坐标换算、区块实例化、静态图基础对象增删、临时加载、完整加载状态切换、卸载与降级入口
- 已接线：区块元数据加载由 `ChunkObjectManager` 负责，对象实例同步由 `BoardCore` 协调
- 当前约束：`loadFull()` 与 `downgradeToTemp()` 主要表达状态语义，真正的对象装载/释放并不在 `Chunk` 内部完成

## 相关文档

- [chunk-object-manager-document.md](./chunk-object-manager-document.md)
- [chunk-loader-document.md](./chunk-loader-document.md)
- [board-core-document.md](../../orchestration/docs/board-core-document.md)
