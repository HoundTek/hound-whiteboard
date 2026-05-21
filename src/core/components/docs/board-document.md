# 白板类文档

本文档提供 `Board` 的概述。

`Board` 是 Core 的白板级总控组件。一个白板文件在运行时应只对应一个 `Board` 实例。

## 术语约定

- **白板级状态**：作用域覆盖整个白板实例的状态，如区块实例所有权、当前打开位置、活动对象管理器、历史树等。
- **区块级状态**：只属于某一区块的状态，如区块对象映射、区块层叠图、区块加载状态。
- **缓冲区**：当前为了交互性能而预先保留在内存中的区块集合，通常包含当前区块与其邻区块。
- **当前区块**：当前用户视角所在的区块，或当前主要交互目标区块。
- **临时加载**：只加载区块关系数据或轻量数据，不加载全部对象内容的加载方式。
- **完整加载**：加载区块对象内容与其相关运行时数据的加载方式。
- **决策**：根据当前交互上下文判断“应该加载哪几区块、以什么策略加载、哪些区块应卸载”。
- **执行加载**：实际调用具体区块的加载/卸载方法，让内存状态发生变化。

## 白板类职责

- 维护白板基础信息（宽、高、根目录）
- 维护区块实例所有权与单区块加载状态落地
- 管理全局活动对象管理器 `ActiveObjectManager`
- 管理历史树 `UndoTree`
- 提供白板加载、创建与对象写入接口

## 核心字段

| 名称                  | 描述                   | 类型                                                                      |
| --------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `undoTree`            | 时间回溯树             | `UndoTree`                                                                |
| `activeObjectManager` | 活动对象管理器         | `ActiveObjectManager`                                                     |
| `chunkLoaded`          | 区块 id 到区块加载状态映射 | `Map<number, { chunk, tempLoadedCount, fullLoadedCount, loaderStrategy }>` |
| `width`/`height`      | 白板尺寸               | `number`                                                                  |
| `root`                | 白板根目录             | `Directory`                                                               |
| `chunkCounterPool`     | 区块 id 池               | `CounterPool`                                                             |
| `objectCounterPool`   | 对象 id 池             | `CounterPool`                                                             |

## 加载流程 `load(directory)`

说明：当前 `load(directory)` 已通过 components 专用 IPC 文件桥接读取白板快照，接口语义为异步。

当前实现流程：

1. 读取并校验 `meta.json` 与 `config.json`
2. 读取 `chunks/connection.json`，恢复文件格式中的区块组织快照与区块计数信息
3. 读取 `trace.json`（若缺失则默认坐标为 `{ x: 0, y: 0 }` 的区块）
4. 准备当前区块实例，后续实际缓冲区预取交由 `ChunkLoader` 决定

该流程已经可作为白板运行时初始化骨架。

## 与 `ChunkLoader` 的协作协议

`Board` 与 `ChunkLoader` 的关系应理解为“一个负责白板级决策与落地，一个负责缓冲区状态表达与移动意图”。

### 职责划分

#### `Board` 负责的事

- 持有区块实例所有权
- 接收 `ChunkLoader` 的单区块加载/卸载请求并落地执行
- 调用 `Chunk.loadFull(...)`、`Chunk.loadTemp(...)`、`Chunk.unload()`、`Chunk.unloadTemp()`、`Chunk.downgradeToTemp()` 等方法执行实际加载
- 维护“某区块被哪些 `ChunkLoader` 以何种策略持有”的引用关系

#### `ChunkLoader` 负责的事

- 表达缓冲区窗口及其变化方向
- 记录当前区块引用
- 提供区域缓冲区初始化接口
- 提供“向左/向右移动当前区块”“向左/向右扩展缓冲区”“向左/向右收缩缓冲区”的接口
- 提供临时加载与完整加载两种策略入口
- 为上层提供更稳定的区块缓冲区控制抽象

### 缓冲区初始化的推荐方式

- 业务侧若需要以某区块或某一区域作为起点建立新的缓冲范围，推荐通过自己持有的 `ChunkLoader.init...` 接口完成。
- `ChunkLoader` 是区域区块加载器，更适合表达“以哪些区块为起点重建缓冲区”，而不是提供通用区块查询 API。
- `Board` 不应承担邻域预取或缓冲区组织职责，因此不再提供 `getChunksAroundCoordinate(...)` 这类接口。
- `Board.getChunkById(...)`、`Board.getChunkByCoordinate(...)` 更适合作为白板内部的单区块实例访问点，而不是业务层的缓冲区入口。

### 多个 `ChunkLoader` 并存时的规则

- 同一个 `Board` 可以挂接多个 `ChunkLoader`
- 某区块只要仍被任意一个 `ChunkLoader` 持有，就不能真正卸载
- 若某区块的完整加载持有者清零，但仍有临时加载持有者，则该区块应从完整加载降级为临时加载
- 只有当完整加载持有者和临时加载持有者都清零时，该区块才会真正卸载

### 典型协作流程

#### 场景一：用户翻到右区块

1. `Board` 判断当前操作属于正常浏览/编辑翻区块。
2. `Board` 驱动 `ChunkLoader` 将当前区块向右移动，或向右扩展缓冲区。
3. `Board` 决定右侧新区块应采用完整加载。
4. `Board` 调用对应 `Chunk` 的完整加载接口。
5. 若超过缓冲区限制，由 `Board` 决定卸载缓冲区另一端的区块。

#### 场景二：活动对象跨区块访问

1. `Board` 判断当前操作只需要层叠关系而不需要完整对象内容。
2. `Board` 驱动 `ChunkLoader` 向目标方向扩展缓冲区。
3. `Board` 采用临时加载策略加载目标区块。
4. 操作结束后，`Board` 决定是否回收临时区块。

#### 场景三：完整区块回收但仍需保留层叠图

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

这些都超出了 `ChunkLoader` 的职责范围。而且还会同时存在多个 `ChunkLoader` 互相打架的情况。因此执行权必须保留在 `Board`。

## 设计约束

- 区块实例所有权归 `Board`。
- 活动对象关系不直接写入区块静态图，应通过活动对象管理器管理动态关系。
- 设备、工具、历史等高级状态最终应在白板加载阶段统一恢复。
- `ChunkLoader` 只表达缓冲区控制意图，不直接执行区块加载。
- 区块加载策略的最终裁决权与执行权归 `Board`。

## 实现状态

- 已实现：白板读取校验、单区块实例管理骨架、活动对象管理器/历史树挂载、多 `ChunkLoader` 引用计数与完整区块降级。
- 待完善：完整新建流程、对象计数池初始化、历史与设备状态恢复、区块与对象全链路落盘。

## 相关文档

- [components-document.md](./components-document.md)
- [chunk-loader-document.md](./chunk-loader-document.md)
- [chunk-document.md](./chunk-document.md)
- [active-object-document.md](./active-object-document.md)
- [tier-graph-document.md](./tier-graph-document.md)
