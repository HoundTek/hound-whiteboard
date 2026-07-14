# 区块加载器文档

本文档提供 `ChunkLoader` 的概述。

`ChunkLoader` 是区块实例的直接持有者。它负责缓存区块对象，并提供按区块 id 或二维坐标访问、卸载与清空的统一入口。

## 模块定位

`ChunkLoader` 解决的是“谁持有一组区块实例”这个问题。

它的职责边界是：

- 持有当前 loader 作用域中的区块实例
- 提供按区块 id / 坐标解析区块实例的统一入口
- 维护当前持有集合内部的四向邻接引用
- 发出区块加载、区块卸载与缓冲区更新事件
- 清理当前 loader 的持有关系与事件上下文

它不负责：

- 表达“当前区块”
- 维护连续矩形缓冲区边界
- 决定 TEMP/FULL 的真正加载实现
- 决定对象何时被真正装入 `BoardCore.objectLoaded`

## 核心字段

| 名称               | 描述                                | 类型                              |
| ------------------ | ----------------------------------- | --------------------------------- |
| `chunksLoaded`     | 当前 loader 持有的区块实例映射      | `Map<number, Chunk>`              |
| `resolveChunkById` | 缓存未命中时的区块解析器            | `(chunkId) => Chunk \| undefined` |
| `unloadChunk`      | 区块移除前的卸载钩子                | `(chunk) => boolean \| void`      |
| `eventBus`         | 区块加载相关事件总线                | `EventBus \| undefined`           |
| `requesterId`      | 当前 loader 在事件总线中的请求方 id | `number \| string \| undefined`   |

## 访问模型

### `getChunkById(chunkId)`

当前流程：

1. 若当前已持有该区块，直接返回缓存实例
2. 若未持有，优先调用 `resolveChunkById(chunkId)`
3. 若未提供解析器，则回退到 `Chunk.fromId(chunkId)`
4. 将结果纳入当前 `ChunkLoader` 持有范围
5. 刷新当前持有集合内部的邻接引用

### `getChunkByCoordinate(x, y)`

先将二维坐标转换为区块 id，再复用 `getChunkById(...)`。

## 卸载模型

### `unloadChunkById(chunkId)` / `unloadChunkByCoordinate(x, y)`

卸载当前 loader 持有的某个区块。

若配置了 `unloadChunk(chunk)` 钩子，则会先执行它：

- 返回 `false`：拒绝卸载
- 返回其它值：允许继续从 `chunksLoaded` 中移除

### `clear()`

遍历当前持有的全部区块，逐个调用卸载流程。

适合“需要真实触发卸载逻辑”的场景。

### `reset()`

只清空当前持有关系，不触发 `unloadChunk` 钩子。

### `destroy()`

当前实现会：

- 对所有已持有区块发出 `REQUEST_UNLOAD`
- 清空本地持有关系
- 释放 `eventBus`、`resolveChunkById`、`unloadChunk`、`requesterId`

## 与 `BoardCore` 的关系

当前运行时中：

- **`BoardCore`** 持有一个根 `ChunkLoader`：`rootChunkLoader`
- `BoardCore.getChunkById(...)` / `getChunkByCoordinate(...)` 都委托给这个根 loader
- `BoardCore.createChunkLoader(requesterId)` 可创建新的独立 loader

也就是说，这里的“Board”应理解为 **Worker 侧 `BoardCore`**，而不是 UI 侧 `Board` facade。

## 与 ViewportCore / AOM 的关系

- `ViewportCore` 当前通过 `boardCore.createChunkLoader(...)` 持有自己的视口区块集合
- `ActiveObjectManager` 在跨区块操作中也会创建临时 loader
- 这些 loader 通过事件总线向 `BoardCore` 请求 TEMP / FULL 加载与卸载

`ChunkLoader` 自身只负责发事件，不负责完成真正的 FULL/TEMP 语义。

## 事件接口

当前相关事件名包括：

- `chunk-loader:request-load`
- `chunk-loader:request-unload`
- `chunk-loader:buffer-updated`
- `chunk-loader:load-complete`

对应常量定义在 `CHUNK_LOAD_EVENTS`。

## 实现状态

- 已实现：区块实例持有、按 id/坐标获取、按 id/坐标卸载、清空持有集合、集合内部邻接同步，以及区块加载相关事件发射
- 已接线：`BoardCore` 根 loader、`ViewportCore` loader、AOM 临时 loader
- 待完善：更细粒度的 loader 共享策略、生命周期统计，以及更复杂的错误恢复路径

## 相关文档

- [board-core-document.md](../../orchestration/docs/board-core-document.md)
- [viewport-core-document.md](../../orchestration/docs/viewport-core-document.md)
- [chunk-document.md](./chunk-document.md)
