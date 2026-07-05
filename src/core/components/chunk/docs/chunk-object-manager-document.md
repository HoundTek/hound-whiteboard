# 区块对象管理器文档

本文档提供 `ChunkObjectManager` 的概述。

`ChunkObjectManager` 负责管理单区块内的静态图与对象覆盖区块索引，是区块级关系数据维护的核心组件。

## 何为区块对象管理

现阶段职责为：

1. 本区块对象层叠关系图（仅存对象 id 关系）
2. 本区块对象覆盖区块索引
3. 通过 `Board` 间接解析对象实例

这三部分相互配合：

- 图决定对象间遮挡/上下文关系
- 对象实例本身由 `Board.objectLoaded` 决定其运行时内容（几何、样式、渲染属性）

## 核心字段

| 名称                | 描述                 | 类型                       |
| ------------------- | -------------------- | -------------------------- | ---------- |
| `staticGraph`       | 区块静态层叠图       | `DirectedGraph`            |
| `objectCoverChunks` | 对象覆盖区块 id 索引 | `Map<number, Set<number>>` |
| `board`             | 所属白板引用         | `Board                     | undefined` |

其中：

- `staticGraph` 记录本区块可见的对象层叠关系
- `objectCoverChunks` 记录“某对象覆盖到哪些区块 id”
- 对象实例本身不再由区块持有，而是通过 `board.getObjectById(...)` 间接获取

对象持久化时，区块描述也统一使用区块 id：

- 区块自身通过 `chunkId` 决定目录与层叠图文件位置
- 对象 JSON 内通过 `ownerChunkId` 表示该对象归属哪一区块
- 对象覆盖区块索引通过独立文件 `{root}/chunks/{chunkId}-object-cover.json` 保存

当前实现已经可以基于对象自身的 `Range` 计算覆盖区块：

- 先取对象主判定范围 `obj.getRange()`
- 再叠加对象位置得到世界坐标范围
- 然后与候选区块矩形逐一做 range 相交判断
- 最终得到精确的覆盖区块 id 集合

这份索引不是只给持久化层使用。当前 `ActiveObjectManager.pickup(...)` 会直接读取 `objectCoverChunks` 来决定跨哪些区块继续拾取，所以它既是区块级缓存索引，也是运行时行为索引。

因此这里有一条关键约束：

- 对象创建完成后，应立即为该对象建立覆盖区块索引。
- 对象几何范围发生变化后，应刷新该对象的覆盖区块索引。
- 活动对象经 `ActiveObjectManager.apply(...)` 提交回白板时，应把对象节点、静态关系和覆盖区块索引一起写回相关区块。
- 如果运行时索引落后于对象真实几何，AOM 的跨区块拾取和分层都会读取到旧覆盖范围。

## 层叠图接口

### `loadTierGraph(boardRootPath)`

通过 components 专用 IPC 桥从主进程读取层叠图并反序列化：

- 输入结构由 `DirectedGraph.parse(...)` 处理
- 同时读取独立的对象覆盖区块索引文件
- 当前实现会直接替换 `staticGraph` 与 `objectCoverChunks`
- 当 `boardRootPath` 为空时，视为内存板面（in-memory board），直接 no-op，不触发文件系统访问

### `saveTierGraph(boardRootPath)`

通过专用 IPC 桥持久化静态图与对象覆盖区块索引。

- 当 `boardRootPath` 为空时直接 no-op，用于 demo 这类不入磁盘板面

### `unloadTierGraph()`

释放静态图引用，供临时区块卸载使用。

## 对象读写接口

- `getObject(objectId)`：通过 `Board` 间接获取对象实例
- `loadObjects(boardRootPath)`：委托 `Board` 加载该区块归属对象
- `saveObjects(boardRootPath)`：委托 `Board` 保存该区块归属对象
- `unloadObjects()`：通知 `Board` 清理该区块相关对象实例
- `unload()`：统一卸载层叠图与对象索引

## API

| 名称                                                           | 描述                               | 类型                                           |
| -------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------- | ---------- |
| `setObjectCoverChunks(objectId, chunkIds)`                     | 设置对象覆盖区块 id 集合           | `(number, Iterable<number>) => void`           |
| `getObjectCoverChunks(objectId)`                               | 获取对象覆盖区块 id 集合           | `(number) => Set<number>`                      |
| `serializeObjectCoverChunks()`                                 | 序列化对象覆盖区块索引             | `() => Array<[number, number[]]>`              |
| `syncObjectCoverChunksForObject(obj, chunkWidth, chunkHeight)` | 基于对象 range 重算覆盖区块        | `(BasicObject, number, number) => Set<number>` |
| `syncAllObjectCoverChunks(chunkWidth, chunkHeight)`            | 重建当前区块全部对象的覆盖区块索引 | `(number, number) => Map<number, Set<number>>` |
| `loadTierGraph(boardRootPath)`                                 | 加载区块层叠图                     | `(string) => Promise<void>`                    |
| `saveTierGraph(boardRootPath)`                                 | 保存区块层叠图                     | `(string) => Promise<void>`                    |
| `unloadTierGraph()`                                            | 卸载区块层叠图                     | `() => void`                                   |
| `getObject(objectId)`                                          | 间接获取对象实例                   | `(number) => BasicObject \\                    | undefined` |
| `loadObjects(boardRootPath)`                                   | 加载区块对象                       | `(string) => Promise<void>`                    |
| `saveObjects(boardRootPath)`                                   | 保存区块对象                       | `(string) => Promise<void>`                    |
| `unloadObjects()`                                              | 卸载区块对象                       | `() => void`                                   |
| `unload()`                                                     | 卸载本区块全部数据                 | `() => void`                                   |

## 与其它组件的关系

- 被 [chunk-document.md](./chunk-document.md) 持有并调度。
- 其静态图与 `objectCoverChunks` 都会被 [active-object-manager-document.md](../../orchestration/docs/active-object-manager-document.md) 的跨区块拾取逻辑读取。
- 当活动对象提交回白板时，AOM 会把对象重新写回相关 `ChunkObjectManager`。
- 底层依赖 `src/core/utils/directed-graph.js`。

## 实现状态

- 已实现：数据结构定义、按区块 id 的对象覆盖索引、层叠图加载/保存、经 `Board` 间接读取对象、统一卸载入口、基于 `Range` 的精确覆盖区块计算。
- 已接线：对象创建完成后可建立 owner chunk 上的对象节点与覆盖区块索引；AOM `apply()` 可将活动对象重新写回相关区块；对象实例的加载、保存与回收由 `Board` 统一调度。
- 待完善：对象修改/删除/归属区块迁移路径上的覆盖区块索引自动刷新，以及对象增量落盘策略与更细粒度错误恢复。
