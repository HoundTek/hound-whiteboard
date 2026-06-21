# 白板类文档

本文档提供 `Board` 的概述。

`Board` 是 Core 的白板级总控组件。一个白板文件在运行时应只对应一个 `Board` 实例。

当前 `Board` 的持久化模式由 `rootPath` 是否可用直接推导：

- `filesystem`：存在可用 `rootPath`，允许区块层叠图、对象数据等通过 file-operate bridge 落到文件系统
- `memory`：没有可用 `rootPath`，当前白板视为纯内存运行时，不访问文件系统

因此当前实现里，`rootPath` 既是持久化根目录，也是模式判定入口。

## 术语约定

- **白板级状态**：作用域覆盖整个白板实例的状态，如区块实例所有权、当前打开位置、活动对象管理器、历史树等。
- **区块级状态**：只属于某一区块的状态，如区块层叠图、对象覆盖区块索引、区块加载状态。
- **缓冲区**：当前为了交互性能而预先保留在内存中的区块集合，通常包含当前区块与其邻区块。
- **当前区块**：当前用户视角所在的区块，或当前主要交互目标区块。
- **临时加载**：只加载区块关系数据或轻量数据，不加载全部对象内容的加载方式。
- **完整加载**：加载区块对象内容与其相关运行时数据的加载方式。
- **决策**：根据当前交互上下文判断“应该加载哪几区块、以什么策略加载、哪些区块应卸载”。
- **执行加载**：实际调用具体区块的加载/卸载方法，让内存状态发生变化。

## 白板类职责

- 维护白板基础信息（宽、高、根路径、持久化模式）
- 通过根 `ChunkLoader` 维护区块实例所有权
- 维护单区块加载状态落地
- 维护白板级对象实例注册表与对象加载计数
- 管理全局活动对象管理器 `ActiveObjectManager`
- 管理历史树 `UndoTree`
- 管理 monitor 列表与设备信号分发
- 提供区块查询、monitor 创建与对象写入接口

## 核心字段

| 名称                  | 描述                       | 类型                                                                       |
| --------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `undoTree`            | 时间回溯树                 | `UndoTree`                                                                 |
| `activeObjectManager` | 活动对象管理器             | `ActiveObjectManager`                                                      |
| `chunkLoaded`         | 区块 id 到区块加载状态映射 | `Map<number, { chunk, tempLoadedCount, fullLoadedCount, loaderStrategy }>` |
| `objectLoaded`        | 对象 id 到对象加载状态映射 | `Map<number, { obj, loadedCount }>`                                        |
| `rootChunkLoader`     | 白板根区块加载器           | `ChunkLoader`                                                              |
| `chunkLoadEventBus`   | 区块加载事件总线           | `EventBus`                                                                 |
| `signalsEventBus`     | 设备信号事件总线           | `EventBus`                                                                 |
| `monitors`            | 已挂接 monitor 集合        | `Map<string, Monitor>`                                                     |
| `width`/`height`      | 白板尺寸                   | `number`                                                                   |
| `rootPath`            | 白板根路径                 | `string \| undefined`                                                      |
| `objectCounterPool`   | 对象 id 池                 | `CounterPool`                                                              |

## 持久化模式

持久化模式由一条规则推导：

- 传入有效 `rootPath` 时，`Board.getPersistenceMode()` 返回 `filesystem`
- 未传或传入空白 `rootPath` 时，返回 `memory`
- `resolvePersistenceRootPath(...)` 会在 `memory` 模式下统一返回 `undefined`
- 区块 tier graph 与对象 entries 的文件访问逻辑都以前述入口短路

这里有一个当前阶段的重要约束：

- `memory` 模式下，区块卸载请求会在 `Board` 落地层被直接拒绝
- 这意味着纯内存白板里的区块一旦进入运行时，就默认继续常驻，适合 demo 与非持久化会话

## 区块加载协调流程

当前 `Board` 不直接暴露一个总入口式的 `load(directory)` 流程。现阶段更稳定的是“按区块加载事件驱动”的协调链路。

当前实现流程：

1. `ChunkLoader` 或根 `ChunkLoader` 通过 `chunkLoadEventBus` 发出单区块加载/卸载请求。
2. `Board` 记录请求方对该区块的持有策略，维护 `tempLoadedCount`、`fullLoadedCount` 与 `loaderStrategy`。
3. 若目标策略为 `full`，则执行 `Chunk.loadFull(...)`；若只是 `temp`，则执行 `Chunk.loadTemp(...)` 或保持现状。
4. 当区块进入或退出完整加载时，`Board` 会同步该区块涉及对象的 `loadedCount` 与对象实例注册表。
5. 当完整持有者清零但仍有临时持有者时，区块从完整加载降级为临时加载；只有全部持有都清零且当前为 `filesystem` 模式时才真正卸载。

也就是说，`Board` 当前最关键的职责不是“整板一次性载入”，而是“在多请求方并存时保证区块与对象引用计数一致”。

## 对象加载模型

当前对象实例的运行时所有权已经从 `ChunkObjectManager` 上移到 `Board`。

现在的边界是：

- `Board` 持有 `objectLoaded: Map<number, { obj, loadedCount }>`
- `ChunkObjectManager` 只持有 `staticGraph` 和 `objectCoverChunks`
- 任何需要对象实例的调用方，都应优先通过 `Board.getObjectById(...)` 或 `ChunkObjectManager.getObject(...)` 间接获取

这里的 `loadedCount` 语义，和区块本身的 loader count 不同。

- 区块的 `tempLoadedCount/fullLoadedCount` 只表示“这个区块被多少加载器以何种策略持有”
- 对象的 `loadedCount` 表示“该对象覆盖到的所有区块中，当前被完整加载持有的次数总和”

例如：

- 对象 `o1` 覆盖区块 `c1` 和 `c2`
- `m1` 完整加载 `c1`
- `m2` 完整加载 `c1` 和 `c2`

那么 `o1.loadedCount = 3`

也就是：

- `c1` 上的完整加载持有贡献 `2`
- `c2` 上的完整加载持有贡献 `1`

`Board` 当前按“对象覆盖区块集合上的 `fullLoadedCount` 求和”来维护这个值，并在按区块加载对象时把反序列化出的实例统一写回 `objectLoaded`。

当对象的 `loadedCount` 降为 `0` 时：

- 若该对象当前不在活动层里，`Board` 会把它从 `objectLoaded` 注册表中回收
- 若该对象仍在活动层里，则继续保留实例，等待活动态结束后再由后续同步路径决定是否回收

## 与 `ChunkLoader` 的关系

当前实现中，`Board` 自己持有一个根 `ChunkLoader`，并通过 `createChunkLoader()` 为消费者创建独立的加载器。

这意味着：

- `Board` 是白板级区块实例所有权的上层入口
- 根 `ChunkLoader` 是具体的区块对象持有者
- 根 `ChunkLoader` 也是区块加载事件的直接发送者
- `Board.getChunkById(...)` 与 `Board.getChunkByCoordinate(...)` 都委托给根 `ChunkLoader`
- `Board.getChunkLoader()` 用于显式暴露这个根 loader
- `Board.createChunkLoader(requesterId)` 创建绑定到 Board 事件总线的新 `ChunkLoader`

## 对外区块访问接口

当前 `Board` 暴露的区块访问入口：

- `getChunkById(chunkId)`：通过根 `ChunkLoader` 按 id 获取区块
- `getChunkByCoordinate(x, y)`：通过根 `ChunkLoader` 按二维坐标获取区块
- `getChunkLoader()`：直接获取根 `ChunkLoader`
- `createChunkLoader(requesterId)`：创建独立的 `ChunkLoader`（用于 Monitor 的视口同步、AOM 的临时加载等）

## 加载协作协议

### 多 `ChunkLoader` 并存时的规则

- 同一个 `Board` 可以挂接多个 `ChunkLoader`
- 某区块只要仍被任意一个 `ChunkLoader` 持有，就不能真正卸载
- 若某区块的完整加载持有者清零，但仍有临时加载持有者，则该区块应从完整加载降级为临时加载
- 只有当完整加载持有者和临时加载持有者都清零，且当前白板允许持久化时，该区块才会真正卸载
- 若当前白板处于 `memory` 模式，则卸载请求会保留为 no-op，不会驱逐已进入运行时的区块

### 场景：完整区块回收但仍需保留层叠图

1. 一个 `ChunkLoader` 请求完整加载某区块，另一个 `ChunkLoader` 只请求该区块的临时加载。
2. 完整加载持有者释放该区块后，`Board` 检查到仍存在临时加载持有者。
3. `Board` 不直接卸载该区块，而是调用 `Chunk.downgradeToTemp()`。
4. 该区块保留层叠图，等待最后一个临时持有者释放后再真正卸载。

### 为什么执行权必须在 `Board`

原因是区块加载并不是一个孤立动作，它会影响：

- 白板级缓存状态
- 当前区块与邻区块关系
- 工具与设备恢复逻辑
- 历史状态与对象一致性

因此执行权必须保留在 `Board`。

## 设计约束

- 白板级区块实例所有权通过根 `ChunkLoader` 归 `Board` 管辖。
- 活动对象关系不直接写入区块静态图，应通过活动对象管理器管理动态关系。
- 设备、工具、历史等高级状态最终应在白板加载阶段统一恢复。
- `ChunkLoader` 是区块对象持有者，不直接执行加载。
- 区块加载策略的最终裁决权与执行权归 `Board`。

## 实现状态

- 已实现：根 `ChunkLoader` 区块持有、区块加载事件协调、白板级对象注册表、对象 `loadedCount` 维护、活动对象管理器/历史树挂载、monitor 创建、设备信号转发、多 `ChunkLoader` 引用计数与完整区块降级、显式持久化模式、memory 模式文件桥短路与区块常驻。
- 待完善：白板整体快照读写入口、对象计数池初始化恢复、历史与设备状态恢复、区块与对象全链路落盘。

## 相关文档

- [components-document.md](./components-document.md)
- [chunk-loader-document.md](./chunk-loader-document.md)
- [chunk-document.md](./chunk-document.md)
- [active-object-manager-document.md](./active-object-manager-document.md)
- [tier-graph-document.md](./tier-graph-document.md)
