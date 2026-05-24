# 白板类文档

本文档提供 `Board` 的概述。

`Board` 是 Core 的白板级总控组件。一个白板文件在运行时应只对应一个 `Board` 实例。

当前 `Board` 已支持显式持久化模式：

- `filesystem`：允许区块层叠图、对象数据等通过 file-operate bridge 落到文件系统
- `memory`：把当前白板视为纯内存运行时，不访问文件系统

若未显式配置，则当前实现仍兼容旧约定：有可用 `rootPath` 时推导为 `filesystem`，否则推导为 `memory`。

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
- 提供白板加载、创建与对象写入接口

## 核心字段

| 名称                        | 描述                       | 类型                                                                       |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `undoTree`                  | 时间回溯树                 | `UndoTree`                                                                 |
| `activeObjectManager`       | 活动对象管理器             | `ActiveObjectManager`                                                      |
| `chunkLoaded`               | 区块 id 到区块加载状态映射 | `Map<number, { chunk, tempLoadedCount, fullLoadedCount, loaderStrategy }>` |
| `objectLoaded`              | 对象 id 到对象加载状态映射 | `Map<number, { obj, loadedCount }>`                                        |
| `rootChunkLoader`           | 白板根区块加载器           | `ChunkLoader`                                                              |
| `width`/`height`            | 白板尺寸                   | `number`                                                                   |
| `rootPath`                  | 白板根路径                 | `string \| undefined`                                                      |
| `configuredPersistenceMode` | 显式配置的持久化模式       | `"memory" \| "filesystem" \| undefined`                                    |
| `chunkCounterPool`          | 区块 id 池                 | `CounterPool`                                                              |
| `objectCounterPool`         | 对象 id 池                 | `CounterPool`                                                              |

## 持久化模式

推荐约定：

- demo、sandbox、一次性演示板面应显式使用 `new Board({ persistenceMode: "memory" })`
- 真正绑定磁盘目录的白板可显式使用 `filesystem`，也可继续沿用“设置 `rootPath` 即推导为文件模式”的兼容路径
- 当 `Board` 处于 `memory` 模式时，区块加载链会把 tier graph / object entries 的文件系统访问整体短路为 no-op

也就是说，`rootPath` 不再是唯一语义来源；显式配置优先，`rootPath` 只作为兼容推导依据。

## 加载流程 `load(directory)`

说明：当前 `load(directory)` 已通过 components 专用 IPC 文件桥接读取白板快照，接口语义为异步。

当前实现流程：

1. 读取并校验 `meta.json` 与 `config.json`
2. 读取 `chunks/connection.json`，恢复文件格式中的区块组织快照与区块计数信息
3. 读取 `trace.json`（若缺失则默认坐标为 `{ x: 0, y: 0 }` 的区块）
4. 准备当前区块实例，后续实际缓冲区预取交由 `ChunkBlockLoader` 决定

该流程已经可作为白板运行时初始化骨架。

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

`Board` 当前按“对象覆盖区块集合上的 `fullLoadedCount` 求和”来维护这个值。

当对象的 `loadedCount` 降为 `0` 时：

- 若该对象当前不在活动层里，`Board` 会把它从 `objectLoaded` 注册表中回收
- 若该对象仍在活动层里，则继续保留实例，等待活动态结束后再由后续同步路径决定是否回收

## 与 `ChunkLoader` 的关系

当前实现中，`Board` 自己持有一个根 `ChunkLoader`。

这意味着：

- `Board` 是白板级区块实例所有权的上层入口
- 根 `ChunkLoader` 是具体的区块对象持有者
- 根 `ChunkLoader` 也是区块加载事件的直接发送者
- `Board.getChunkById(...)` 与 `Board.getChunkByCoordinate(...)` 都委托给根 `ChunkLoader`
- `Board.getChunkLoader()` 用于显式暴露这个根 loader

这样做的目的，是把“区块对象由谁持有”与“当前要维护一个什么形状的缓冲区”拆开。

因此这里有一个稳定边界：

- `ChunkLoader` 负责持有区块对象
- `ChunkBlockLoader` 负责包装 `ChunkLoader` 并表达连续矩形范围

## 对外区块访问接口

当前 `Board` 暴露三类区块访问入口：

- `getChunkById(chunkId)`：通过根 `ChunkLoader` 按 id 获取区块
- `getChunkByCoordinate(x, y)`：通过根 `ChunkLoader` 按二维坐标获取区块
- `getChunkLoader()`：直接获取根 `ChunkLoader`

推荐约定：

- 若业务只需要访问或卸载某个具体区块，优先使用根 `ChunkLoader` 及其包装入口
- 若业务需要维护一个连续矩形范围的缓冲区，使用 `ChunkBlockLoader`

## 与 `ChunkBlockLoader` 的协作协议

`Board` 与 `ChunkBlockLoader` 的关系应理解为“一个负责白板级决策与落地，一个负责缓冲区状态表达与移动意图”。

### 职责划分

#### `Board` 负责的事

- 通过根 `ChunkLoader` 持有区块实例所有权
- 接收 `ChunkBlockLoader` 的单区块加载/卸载请求并落地执行
- 调用 `Chunk.loadFull(...)`、`Chunk.loadTemp(...)`、`Chunk.unload()`、`Chunk.unloadTemp()`、`Chunk.downgradeToTemp()` 等方法执行实际加载
- 维护“某区块被哪些 `ChunkBlockLoader` 以何种策略持有”的引用关系

#### `ChunkBlockLoader` 负责的事

- 包装一个独立的 `ChunkLoader`
- 表达缓冲区窗口及其变化方向
- 记录当前区块引用
- 提供区域缓冲区初始化接口
- 提供“向左/向右移动当前区块”“向左/向右扩展缓冲区”“向左/向右收缩缓冲区”的接口
- 提供临时加载与完整加载两种策略入口
- 通过内部 `ChunkLoader` 间接发送加载、卸载和缓冲区更新事件
- 为上层提供更稳定的区块缓冲区控制抽象

### 缓冲区初始化的推荐方式

- 业务侧若需要以某区块或某一区域作为起点建立新的缓冲范围，推荐通过自己持有的 `ChunkBlockLoader.init...` 接口完成。
- `ChunkBlockLoader` 是区域区块加载器，更适合表达“以哪些区块为起点重建缓冲区”，而不是提供通用区块查询 API。
- `Board` 不应承担邻域预取或缓冲区组织职责，因此不再提供 `getChunksAroundCoordinate(...)` 这类接口。
- `Board.getChunkById(...)`、`Board.getChunkByCoordinate(...)` 与 `Board.getChunkLoader()` 更适合作为白板级单区块访问入口，而不是业务层的矩形缓冲区入口。

### 多个 `ChunkBlockLoader` 并存时的规则

- 同一个 `Board` 可以挂接多个 `ChunkBlockLoader`
- 某区块只要仍被任意一个 `ChunkBlockLoader` 持有，就不能真正卸载
- 若某区块的完整加载持有者清零，但仍有临时加载持有者，则该区块应从完整加载降级为临时加载
- 只有当完整加载持有者和临时加载持有者都清零时，该区块才会真正卸载

### 典型协作流程

#### 场景一：用户翻到右区块

1. `Board` 判断当前操作属于正常浏览/编辑翻区块。
2. `Board` 驱动 `ChunkBlockLoader` 将当前区块向右移动，或向右扩展缓冲区。
3. `Board` 决定右侧新区块应采用完整加载。
4. `Board` 调用对应 `Chunk` 的完整加载接口。
5. 若超过缓冲区限制，由 `Board` 决定卸载缓冲区另一端的区块。

#### 场景二：活动对象跨区块访问

1. `Board` 判断当前操作只需要层叠关系而不需要完整对象内容。
2. `Board` 驱动 `ChunkBlockLoader` 向目标方向扩展缓冲区。
3. `Board` 采用临时加载策略加载目标区块。
4. 操作结束后，`Board` 决定是否回收临时区块。

#### 场景三：完整区块回收但仍需保留层叠图

1. 一个 `ChunkBlockLoader` 请求完整加载某区块，另一个 `ChunkBlockLoader` 只请求该区块的临时加载。
2. 完整加载持有者释放该区块后，`Board` 检查到仍存在临时加载持有者。
3. `Board` 不直接卸载该区块，而是调用 `Chunk.downgradeToTemp()`。
4. 该区块保留层叠图，等待最后一个临时持有者释放后再真正卸载。

### 为什么执行权必须在 `Board`

原因是区块加载并不是一个孤立动作，它会影响：

- 白板级缓存状态
- 当前区块与邻区块关系
- 工具与设备恢复逻辑
- 历史状态与对象一致性

这些都超出了 `ChunkBlockLoader` 的职责范围。而且还会同时存在多个 `ChunkBlockLoader` 互相打架的情况。因此执行权必须保留在 `Board`。

## 设计约束

- 白板级区块实例所有权通过根 `ChunkLoader` 归 `Board` 管辖。
- 活动对象关系不直接写入区块静态图，应通过活动对象管理器管理动态关系。
- 设备、工具、历史等高级状态最终应在白板加载阶段统一恢复。
- `ChunkLoader` 是区块对象持有者。
- `ChunkBlockLoader` 只表达缓冲区控制意图，不直接执行区块加载。
- `ChunkBlockLoader` 只负责连续矩形范围，不负责区块对象的最终持有。
- 区块加载策略的最终裁决权与执行权归 `Board`。

## 实现状态

- 已实现：白板读取校验、根 `ChunkLoader` 区块持有、单区块实例管理骨架、白板级对象注册表、对象 `loadedCount` 维护、活动对象管理器/历史树挂载、多 `ChunkBlockLoader` 引用计数与完整区块降级。
- 待完善：完整新建流程、对象计数池初始化、历史与设备状态恢复、区块与对象全链路落盘。

## 相关文档

- [components-document.md](./components-document.md)
- [chunk-loader-document.md](./chunk-loader-document.md)
- [chunk-block-loader-document.md](./chunk-block-loader-document.md)
- [chunk-document.md](./chunk-document.md)
- [active-object-document.md](./active-object-document.md)
- [tier-graph-document.md](./tier-graph-document.md)
