# 区块加载器文档

`ChunkLoader` 是区块实例的直接持有者。

## 模块定位

`ChunkLoader` 解决的是“谁持有一组区块实例”这个问题。

它的职责边界是：

- 持有当前 loader 作用域中的区块实例
- 提供按区块 id / 坐标解析区块实例的统一入口
- 发出区块加载与区块卸载事件
- 清理当前 loader 的持有关系与事件上下文

它不负责：

- 表达“当前区块”
- 维护连续矩形缓冲区边界
- 决定 TEMP/FULL 的真正加载实现（`ChunkLoader` 自身只负责发事件）
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

| 方法                                                                       | 职责                   | 与既有方法的差异                                                                           |
| -------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `trackChunk(chunk)`                                                        | 把区块实例纳入持有范围 | 不解析 id，也不执行卸载钩子；输入不是 `Chunk` 时抛 `TypeError`                             |
| `untrackChunkById(chunkId)`                                                | 仅从持有关系中移除区块 | 跳过 `unloadChunk` 钩子，这正是它与 `unloadChunkById(...)` 的分工                          |
| `emitLoadRequest(chunk, { strategy, direction, source, alreadyBuffered })` | 发出 `REQUEST_LOAD`    | 只发事件，不改持有关系；`strategy` 取值来自 `CHUNK_LOAD_STRATEGIES`（`"temp"` / `"full"`） |
| `emitUnloadRequest(chunk, { source })`                                     | 发出 `REQUEST_UNLOAD`  | 只发事件，不执行卸载钩子，也不移除持有                                                     |
| `getLoadedChunks()`                                                        | 返回持有区块的数组快照 | 只读取快照，不改动持有关系                                                                 |

`ViewportCore` 的视口维护路径用的就是这一组方法：先 `getLoadedChunks()` 取快照，再对新区块 `emitLoadRequest(chunk, { strategy: CHUNK_LOAD_STRATEGIES.FULL })`，对离开范围的区块 `emitUnloadRequest(chunk)` 后 `untrackChunkById(chunk.id)`。

### `getChunkById(chunkId)`

当前流程：

1. `chunkId` 不是正整数时直接返回 `undefined`
2. 若当前已持有该区块，直接返回缓存实例
3. 若未持有，优先调用 `resolveChunkById(chunkId)`
4. 若未提供解析器，则回退到 `Chunk.fromId(chunkId)`
5. 结果若是 `Chunk` 则纳入持有并返回，否则返回 `undefined`

### `getChunkByCoordinate(x, y)`

先将二维坐标转换为区块 id，再复用 `getChunkById(...)`。

## 卸载模型

### `unloadChunkById(chunkId)`

卸载当前 loader 持有的某个区块。

若配置了 `unloadChunk(chunk)` 钩子，则会先执行它：

- 返回 `false`：拒绝卸载
- 返回其它值：允许继续从 `chunksLoaded` 中移除

### `clear()`

遍历当前持有的全部区块，逐个调用卸载流程。

适合“需要真实触发卸载逻辑”的场景。

### `destroy(delayMs?)`

当前实现会：

- 对所有已持有区块发出 `REQUEST_UNLOAD`
- 清空本地持有关系
- 释放 `eventBus`、`resolveChunkById`、`unloadChunk`、`requesterId`

传入 `delayMs > 0` 时为延时销毁：先挂起定时，到期后才执行上述销毁；定时期间任何追踪/访问方法（`trackChunk`、`getChunkById`、`emitLoadRequest` 等）会自动取消挂起的定时。AOM 在 `apply()` 批量预加载后以 `destroy(300)` 延时销毁临时 loader，保留已预加载区块供短时间内后续 apply 复用缓存。

## 与 `BoardCore` 的关系

当前运行时中：

- **`BoardCore`** 持有一个根 `ChunkLoader`：`rootChunkLoader`
- `BoardCore.getChunkById(...)` / `getChunkByCoordinate(...)` 都委托给这个根 loader
- `BoardCore.createChunkLoader(requesterId)` 可创建新的独立 loader

本文件的 Board 均指 Worker 侧 `BoardCore`；UI 侧 `Board` facade 不参与区块持有。

## 与 ViewportCore / AOM 的关系

- `ViewportCore` 当前通过 `boardCore.createChunkLoader(...)` 持有自己的视口区块集合
- `ActiveObjectManager` 在跨区块操作中也会创建临时 loader
- 这些 loader 通过事件总线向 `BoardCore` 请求 TEMP / FULL 加载与卸载

## 事件接口

当前相关事件名包括：

- `chunk-loader:request-load`
- `chunk-loader:request-unload`
- `chunk-loader:load-complete`

对应常量定义在 `CHUNK_LOAD_EVENTS`。

## 当前状态

- 已实现：区块实例持有、按 id/坐标获取、按 id 卸载、清空持有集合，以及区块加载相关事件发射
- 已接线：`BoardCore` 根 loader、`ViewportCore` loader、AOM 临时 loader
- 更细粒度的 loader 共享策略、生命周期统计，以及更复杂的错误恢复路径。[todo]

## 相关文档

- [board-core-document.md](../../board/docs/board-core-document.md)
- [viewport-core-document.md](../../../renderers/canvas/docs/viewport-core-document.md)
- [chunk-document.md](./chunk-document.md)
