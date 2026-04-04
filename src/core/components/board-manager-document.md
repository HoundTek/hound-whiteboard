# 白板管理器文档

本文档提供 `BoardManager` 的概述。

`BoardManager` 是 Core 的白板级总控组件。一个白板文件在运行时应只对应一个 `BoardManager` 实例。

## 术语约定

- 白板级状态：作用域覆盖整个白板实例的状态，如页顺序、当前打开位置、活动对象管理器、历史树等。
- 页级状态：只属于某一页的状态，如页对象映射、页层叠图、页加载状态。
- 缓冲区：当前为了交互性能而预先保留在内存中的页集合，通常包含当前页与其邻页。
- 当前页：当前用户视角所在的页，或当前主要交互目标页。
- 临时加载：只加载页关系数据或轻量数据，不加载全部对象内容的加载方式。
- 完整加载：加载页对象内容与其相关运行时数据的加载方式。
- 决策：根据当前交互上下文判断“应该加载哪几页、以什么策略加载、哪些页应卸载”。
- 执行加载：实际调用具体页的加载/卸载方法，让内存状态发生变化。

## 白板管理器职责

- 维护白板基础信息（宽、高、根目录）
- 维护页映射、页顺序与已加载页队列
- 管理全局活动对象管理器 `ActiveObjectManager`
- 管理历史树 `UndoTree`
- 提供白板加载、创建与对象写入接口

## 核心字段

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `undoTree` | 时间回溯树 | `UndoTree` |
| `activeObjectManager` | 活动对象管理器 | `ActiveObjectManager` |
| `pageMap` | 页 id 到页实例映射 | `Map<number, PageManager>` |
| `pageOrder` | 页顺序数组 | `number[]` |
| `loadedPages` | 已加载页队列 | `Deque` |
| `width`/`height` | 白板尺寸 | `number` |
| `root` | 白板根目录 | `Directory` |
| `pageCounterPool` | 页 id 池 | `CounterPool` |
| `objectCounterPool` | 对象 id 池 | `CounterPool` |

## 加载流程 `load(directory)`

当前实现流程：

1. 读取并校验 `meta.json` 与 `config.json`
2. 读取 `pages/connection.json`，恢复 `pageOrder` 与页 id 池
3. 基于 `pageOrder` 构建页链和 `pageMap`
4. 读取 `trace.json`（若缺失则默认第一页）
5. 加载当前页及相邻页到 `loadedPages`

该流程已经可作为白板运行时初始化骨架。

## 与 `PageLoadManager` 的协作协议

`BoardManager` 与 `PageLoadManager` 的关系应理解为“一个负责白板级决策与落地，一个负责缓冲区状态表达与移动意图”。

### 职责划分

#### `BoardManager` 负责的事

- 持有白板的完整页集合与页顺序
- 判断当前交互场景需要什么加载策略
- 决定应加载哪些页、应卸载哪些页
- 调用 `PageManager.load(...)`、`PageManager.loadTemp(...)`、`PageManager.unload()`、`PageManager.unloadTemp()` 等方法执行实际加载
- 维护白板级的 `loadedPages`、当前打开位置、恢复状态等信息

#### `PageLoadManager` 负责的事

- 表达缓冲区窗口及其变化方向
- 记录当前页引用
- 提供“向左/向右移动当前页”“向左/向右扩展缓冲区”的接口
- 提供临时加载与完整加载两种策略入口
- 为 `BoardManager` 提供一个更稳定的页缓冲区控制抽象

### 典型协作流程

#### 场景一：用户翻到右页

1. `BoardManager` 判断当前操作属于正常浏览/编辑翻页。
2. `BoardManager` 驱动 `PageLoadManager` 将当前页向右移动，或向右扩展缓冲区。
3. `BoardManager` 决定右侧新页应采用完整加载。
4. `BoardManager` 调用对应 `PageManager` 的完整加载接口。
5. 若超过缓冲区限制，由 `BoardManager` 决定卸载缓冲区另一端的页。

#### 场景二：活动对象跨页访问

1. `BoardManager` 判断当前操作只需要层叠关系而不需要完整对象内容。
2. `BoardManager` 驱动 `PageLoadManager` 向目标方向扩展缓冲区。
3. `BoardManager` 采用临时加载策略加载目标页。
4. 操作结束后，`BoardManager` 决定是否回收临时页。

### 为什么执行权必须在 `BoardManager`

原因是页加载并不是一个孤立动作，它会影响：

- 白板级缓存状态
- 当前页与邻页关系
- 工具与设备恢复逻辑
- 历史状态与对象一致性

这些都超出了 `PageLoadManager` 的职责范围。而且还会同时存在多个 `PageLoadManager` 互相打架的情况。因此执行权必须保留在 `BoardManager`。

## 创建流程 `create(directory, boardInfo)`

当前行为：

- 初始化并尝试加载目标目录
- 写入白板元信息（`meta`、`config`）
- 创建/重建 `pages` 目录

后续计划（`todo`）：

- 创建完整文件结构
- 初始化第一页与模板

## 页面与对象操作

### `appendPage()`

- 使用 `pageCounterPool` 生成页 id
- 维护页链与页顺序
- 返回新页实例

当前仍待补：页文件创建、模板初始化、历史树记录。

### `addObject(obj, pageId)`

- 找到目标页
- 委托页管理器写入对象
- 页不存在时抛错

## API

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `load(directory)` | 加载白板 | `Directory -> BoardManager` |
| `appendPage()` | 追加新页 | `void -> PageManager` |
| `addObject(obj, pageId)` | 向指定页添加对象 | `BasicObject -> number -> void` |
| `create(directory, boardInfo)` | 创建白板（静态） | `Directory -> Object -> BoardManager` |

## 设计约束

- 页实例所有权归 `BoardManager`。
- 活动对象关系不直接写入页静态图，应通过活动对象管理器管理动态关系。
- 设备、工具、历史等高级状态最终应在白板加载阶段统一恢复。
- `PageLoadManager` 只表达缓冲区控制意图，不直接执行页加载。
- 页加载策略的最终裁决权与执行权归 `BoardManager`。

## 实现状态

- 已实现：白板读取校验、页链恢复、邻页加载骨架、活动对象管理器/历史树挂载。
- 待完善：完整新建流程、对象计数池初始化、历史与设备状态恢复、页与对象全链路落盘。

## 相关文档

- [components-document.md](./components-document.md)
- [page-load-manager-document.md](./page-load-manager-document.md)
- [page-manager-document.md](./page-manager-document.md)
- [active-object-document.md](./active-object-document.md)
- [tire-graph-document.md](./tire-graph-document.md)
