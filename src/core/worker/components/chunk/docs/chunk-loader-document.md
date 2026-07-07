# 区块加载器文档

本文档提供 `ChunkLoader` 的概述。

`ChunkLoader` 是区块对象的持有者。它负责缓存区块实例，并提供按区块 id 或二维坐标访问、卸载与清空的统一入口。

## 模块定位

`ChunkLoader` 解决的是"谁持有区块对象"这个问题。

因此它的职责边界是：

- 持有当前 loader 作用域中的区块实例
- 负责按区块 id 与二维坐标解析区块实例
- 负责卸载与清空当前持有集合
- 只同步当前持有集合内部的四向邻接引用
- 负责对外发送区块加载、区块卸载与缓冲区更新事件

它不负责：

- 表达"当前区块"
- 维护连续矩形缓冲区边界
- 决定完整加载还是临时加载

## 核心职责

- 管理区块实例映射 `chunksLoaded`
- 提供 `getChunkById(chunkId)`
- 提供 `getChunkByCoordinate(x, y)`
- 提供 `unloadChunkById(chunkId)`
- 提供 `unloadChunkByCoordinate(x, y)`
- 提供 `clear()` 与 `reset()`

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

按区块 id 获取区块实例。

当前流程：

1. 若当前已持有该区块，直接返回缓存实例
2. 若未持有，优先调用 `resolveChunkById(chunkId)`
3. 若未提供解析器，则退回到 `Chunk.fromId(chunkId)`
4. 将结果纳入当前 `ChunkLoader` 持有范围
5. 同步当前持有集合内部的四向邻接引用

### `getChunkByCoordinate(x, y)`

先将二维坐标转换为区块 id，再复用 `getChunkById(...)`。

这保证了：

- 同一 loader 中，同一坐标和同一 id 最终会命中同一个区块实例
- 区块实例复用策略由 loader 自身统一管理

## 卸载模型

### `unloadChunkById(chunkId)` / `unloadChunkByCoordinate(x, y)`

卸载当前 loader 持有的某个区块。

若配置了 `unloadChunk(chunk)` 钩子，则会在真正从 `chunksLoaded` 中移除前先调用它：

- 返回 `false` 表示拒绝卸载
- 返回其它值表示允许继续移除

### `clear()`

遍历当前持有的全部区块，逐个调用卸载流程。

它适合"需要真实执行卸载"的场景。

### `reset()`

只清空当前持有关系，不触发 `unloadChunk` 钩子。

## 与 `Board` 的关系

当前实现中：

- `Board` 自己持有一个根 `ChunkLoader`
- `Board.getChunkById(...)` 与 `Board.getChunkByCoordinate(...)` 都委托给根 `ChunkLoader`
- `Board.getChunkLoader()` 用于暴露该根 loader
- `Board.createChunkLoader()` 会创建绑定到 Board 事件总线的新 `ChunkLoader`，适合需要自行管理加载集合的消费者（如 Viewport、AOM）

## API

| 名称                            | 描述                           | 类型                                     |
| ------------------------------- | ------------------------------ | ---------------------------------------- |
| `getChunkById(chunkId)`         | 按区块 id 获取区块             | `(number) => Chunk \| undefined`         |
| `getChunkByCoordinate(x, y)`    | 按二维坐标获取区块             | `(number, number) => Chunk \| undefined` |
| `unloadChunkById(chunkId)`      | 按区块 id 卸载区块             | `(number) => boolean`                    |
| `unloadChunkByCoordinate(x, y)` | 按坐标卸载区块                 | `(number, number) => boolean`            |
| `clear()`                       | 卸载并清空当前持有集合         | `() => boolean`                          |
| `reset()`                       | 只重置持有集合，不触发卸载钩子 | `() => void`                             |
| `emitLoadRequest(...)`          | 发出区块加载请求               | `(Chunk, Object) => boolean`             |
| `emitUnloadRequest(...)`        | 发出区块卸载请求               | `(Chunk, Object) => boolean`             |
| `emitBufferUpdated(...)`        | 发出缓冲区更新事件             | `(Object) => boolean`                    |

## 实现状态

- 已实现：区块实例持有、按 id/坐标获取、按 id/坐标卸载、清空持有集合、持有集合内部邻接同步，以及区块加载相关事件发射。
- 已接线：`Board` 根区块加载器委托，Viewport/AOM 使用 `Board.createChunkLoader()` 创建独立加载器。
- 待完善：更细粒度的生命周期统计、不同 loader 之间的区块共享策略，以及更完整的错误恢复路径。

## 相关文档

- [board-document.md](../../../../ui/components/orchestration/docs/board-document.md)
