# 白板类文档

本文档提供 `Board` 的概述。

`Board` 是 Core 的白板级总控组件。一个白板文件在运行时应只对应一个 `Board` 实例。

## 术语约定

- **白板级状态**：作用域覆盖整个白板实例的状态，如页实例所有权、当前打开位置、活动对象管理器、历史树等。
- **页级状态**：只属于某一页的状态，如页对象映射、页层叠图、页加载状态。
- **缓冲区**：当前为了交互性能而预先保留在内存中的页集合，通常包含当前页与其邻页。
- **当前页**：当前用户视角所在的页，或当前主要交互目标页。
- **临时加载**：只加载页关系数据或轻量数据，不加载全部对象内容的加载方式。
- **完整加载**：加载页对象内容与其相关运行时数据的加载方式。
- **决策**：根据当前交互上下文判断“应该加载哪几页、以什么策略加载、哪些页应卸载”。
- **执行加载**：实际调用具体页的加载/卸载方法，让内存状态发生变化。

## 白板类职责

- 维护白板基础信息（宽、高、根目录）
- 维护页实例所有权与单页加载状态落地
- 管理全局活动对象管理器 `ActiveObjectManager`
- 管理历史树 `UndoTree`
- 提供白板加载、创建与对象写入接口

## 核心字段

| 名称                  | 描述                   | 类型                                                                      |
| --------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `undoTree`            | 时间回溯树             | `UndoTree`                                                                |
| `activeObjectManager` | 活动对象管理器         | `ActiveObjectManager`                                                     |
| `pageLoaded`          | 页 id 到页加载状态映射 | `Map<number, { page, tempLoadedCount, fullLoadedCount, loaderStrategy }>` |
| `width`/`height`      | 白板尺寸               | `number`                                                                  |
| `root`                | 白板根目录             | `Directory`                                                               |
| `pageCounterPool`     | 页 id 池               | `CounterPool`                                                             |
| `objectCounterPool`   | 对象 id 池             | `CounterPool`                                                             |

## 加载流程 `load(directory)`

说明：当前 `load(directory)` 已通过 components 专用 IPC 文件桥接读取白板快照，接口语义为异步。

当前实现流程：

1. 读取并校验 `meta.json` 与 `config.json`
2. 读取 `pages/connection.json`，恢复文件格式中的页组织快照与页计数信息
3. 读取 `trace.json`（若缺失则默认坐标为 `{ x: 0, y: 0 }` 的页）
4. 准备当前页实例，后续实际缓冲区预取交由 `PageLoader` 决定

该流程已经可作为白板运行时初始化骨架。

## 与 `PageLoader` 的协作协议

`Board` 与 `PageLoader` 的关系应理解为“一个负责白板级决策与落地，一个负责缓冲区状态表达与移动意图”。

### 职责划分

#### `Board` 负责的事

- 持有页实例所有权
- 接收 `PageLoader` 的单页加载/卸载请求并落地执行
- 调用 `Page.loadFull(...)`、`Page.loadTemp(...)`、`Page.unload()`、`Page.unloadTemp()`、`Page.downgradeToTemp()` 等方法执行实际加载
- 维护“某页被哪些 `PageLoader` 以何种策略持有”的引用关系

#### `PageLoader` 负责的事

- 表达缓冲区窗口及其变化方向
- 记录当前页引用
- 提供区域缓冲区初始化接口
- 提供“向左/向右移动当前页”“向左/向右扩展缓冲区”“向左/向右收缩缓冲区”的接口
- 提供临时加载与完整加载两种策略入口
- 为上层提供更稳定的页缓冲区控制抽象

### 缓冲区初始化的推荐方式

- 业务侧若需要以某页或某一区域作为起点建立新的缓冲范围，推荐通过自己持有的 `PageLoader.init...` 接口完成。
- `PageLoader` 是区域页加载器，更适合表达“以哪些页为起点重建缓冲区”，而不是提供通用页查询 API。
- `Board` 不应承担邻域预取或缓冲区组织职责，因此不再提供 `getPagesAroundCoordinate(...)` 这类接口。
- `Board.getPageById(...)`、`Board.getPageByCoordinate(...)` 更适合作为白板内部的单页实例访问点，而不是业务层的缓冲区入口。

### 多个 `PageLoader` 并存时的规则

- 同一个 `Board` 可以挂接多个 `PageLoader`
- 某页只要仍被任意一个 `PageLoader` 持有，就不能真正卸载
- 若某页的完整加载持有者清零，但仍有临时加载持有者，则该页应从完整加载降级为临时加载
- 只有当完整加载持有者和临时加载持有者都清零时，该页才会真正卸载

### 典型协作流程

#### 场景一：用户翻到右页

1. `Board` 判断当前操作属于正常浏览/编辑翻页。
2. `Board` 驱动 `PageLoader` 将当前页向右移动，或向右扩展缓冲区。
3. `Board` 决定右侧新页应采用完整加载。
4. `Board` 调用对应 `Page` 的完整加载接口。
5. 若超过缓冲区限制，由 `Board` 决定卸载缓冲区另一端的页。

#### 场景二：活动对象跨页访问

1. `Board` 判断当前操作只需要层叠关系而不需要完整对象内容。
2. `Board` 驱动 `PageLoader` 向目标方向扩展缓冲区。
3. `Board` 采用临时加载策略加载目标页。
4. 操作结束后，`Board` 决定是否回收临时页。

#### 场景三：完整页回收但仍需保留层叠图

1. 一个 `PageLoader` 请求完整加载某页，另一个 `PageLoader` 只请求该页的临时加载。
2. 完整加载持有者释放该页后，`Board` 检查到仍存在临时加载持有者。
3. `Board` 不直接卸载该页，而是调用 `Page.downgradeToTemp()`。
4. 该页保留层叠图，等待最后一个临时持有者释放后再真正卸载。

### 为什么执行权必须在 `Board`

原因是页加载并不是一个孤立动作，它会影响：

- 白板级缓存状态
- 当前页与邻页关系
- 工具与设备恢复逻辑
- 历史状态与对象一致性

这些都超出了 `PageLoader` 的职责范围。而且还会同时存在多个 `PageLoader` 互相打架的情况。因此执行权必须保留在 `Board`。

## 设计约束

- 页实例所有权归 `Board`。
- 活动对象关系不直接写入页静态图，应通过活动对象管理器管理动态关系。
- 设备、工具、历史等高级状态最终应在白板加载阶段统一恢复。
- `PageLoader` 只表达缓冲区控制意图，不直接执行页加载。
- 页加载策略的最终裁决权与执行权归 `Board`。

## 实现状态

- 已实现：白板读取校验、单页实例管理骨架、活动对象管理器/历史树挂载、多 `PageLoader` 引用计数与完整页降级。
- 待完善：完整新建流程、对象计数池初始化、历史与设备状态恢复、页与对象全链路落盘。

## 相关文档

- [components-document.md](./components-document.md)
- [page-loader-document.md](./page-loader-document.md)
- [page-document.md](./page-document.md)
- [active-object-document.md](./active-object-document.md)
- [tier-graph-document.md](./tier-graph-document.md)
