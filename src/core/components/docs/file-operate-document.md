# 组件文件操作文档

本文档整理 `src/core/components/` 内涉及文件系统读写的实现，重点说明：

- 哪些组件会触发文件操作
- 读写哪些路径
- 通过什么方式执行 I/O（本地/IPC）
- 当前状态与注意事项

## 模块范围

本文件仅覆盖 components 层直接发起的文件操作，不覆盖 tools/devices 或 utils 层通用 I/O 细节。

当前涉及文件操作的组件：

- `Board`
- `PageObjectManager`
- `Page`（通过 `PageObjectManager` 间接触发）

## 白板目录结构约定

根据当前 `Board.create(...)` 的实现，白板根目录至少包含：

- `meta.json`
- `config.json`
- `trace.json`
- `pages/`
- `objects/`
- `devices/`
- `history/`
- `templates/`

核心运行数据主要在：

- `pages/connection.json`：文件格式层的页组织快照；当前桥接层仍按 `count/order/size` 读写
- `pages/{pageId}.json`：页层叠图（tier graph）
- `objects/page{pageId}/*.json`：页对象数据

需要区分：

- `connection.json` 是磁盘格式的一部分。
- `Board` 运行时已不再以 `pageMap/pageOrder/loadedPages` 作为主状态，而是统一到 `pageLoaded`。

## IPC 过桥约定（Renderer Core -> Main）

Core 运行在渲染进程，因此 components 的关键文件操作通过专用 IPC API 转发到主进程执行。

桥接入口：

- 渲染侧：`boardFileOperateBridge`（`file-operate-bridge-renderer.js`）
- 主进程：`handleCoreFileOperateRequest`（`file-operate-bridge-main.js`）
- 通道：`houndwhiteboard:core-file-operate`

当前已桥接动作：

- `create-board-root`
- `create-page-storage`
- `write-page-connection`
- `write-trace`
- `load-board-snapshot`
- `load-tier-graph`
- `save-tier-graph`
- `load-page-objects`
- `save-page-objects`

## Board 文件操作

### 1. 新建白板

对应 API：`Board.create(directory, boardInfo)`

主要行为：

- 通过 `createBoardRoot(...)` 重建根目录并写入 `meta.json`、`config.json`
- 创建 `devices/history/objects/pages/templates` 子目录
- 通过 `appendPage(...)` 创建首个页存储
- 通过 `writeTrace(...)` 写入 `trace.json`

涉及路径：

- `{root}/meta.json`
- `{root}/config.json`
- `{root}/trace.json`
- `{root}/pages/connection.json`

### 2. 添加页面

对应 API：`appendPage(templateId)`

主要行为：

- 通过 `createPageStorage(...)` 重建该页目录：`{root}/pages/{pageId}`
- 通过 `createPageStorage(...)` 重建该页对象目录：`{root}/objects/page{pageId}`
- 更新白板文件格式所需的页连接信息
- 通过 `#persistPageConnection()` 写入 `pages/connection.json`

### 3. 加载白板

对应 API：`load(directory)`

主要行为：

- 通过 `loadBoardSnapshot(...)` 一次获取 `meta/config/connection/trace`
- 渲染侧恢复 `width/height/pageCounterPool`，并根据 `trace.onPage` 或 `connection.order[0]` 选定初始页
- `trace` 缺失时由主进程桥接层回退到 `connection.order[0]`

失败行为：

- 缺失 `meta.json` 或类型不匹配：抛出 `Not a board file`
- 缺失 `config.json` 或 `pages/connection.json`：抛出 `Corrupted board file`

### 4. 页连接持久化

对应 API：`#persistPageConnection()`

写入路径：

- `{root}/pages/connection.json`

写入字段：

- `count`（页计数池）
- `order`（文件格式中的页组织顺序）
- `size`（文件格式中的页数量）

说明：这些字段属于磁盘快照，不代表 `Board` 运行时一定保留同名字段。

### 5. 页目录解析

对应 API：`#resolvePageDirectory(pageId)`

读取策略：

- 优先使用 `{root}/pages/{pageId}`
- 若不存在，回退到 `{root}/pages`

该策略用于兼容当前过渡期的目录/文件布局。

## PageObjectManager 文件操作

`PageObjectManager` 是页级数据读写的核心组件，负责层叠图和对象文件。

说明：当前 `loadTierGraph/saveTierGraph/loadObjects` 已迁移到专用 IPC API。

### 1. 层叠图读取

对应 API：`loadTierGraph(boardRootPath)`

路径：

- `{root}/pages/{pageId}.json`

行为：

- 通过 `loadTierGraph(...)` 从主进程读取 `{root}/pages/{pageId}.json`
- 渲染侧 `DirectedGraph.parse(...)` 反序列化
- 文件不存在时抛错

### 2. 层叠图写入

对应 API：`saveTierGraph(boardRootPath)`

路径：

- `{root}/pages/{pageId}.json`

行为：

- 通过 `saveTierGraph(...)` 写回 `{root}/pages/{pageId}.json`
- 写入内容为 `staticGraph.toArray()`

### 3. 对象覆盖页索引读写

对应 API：`loadTierGraph(boardRootPath)` / `saveTierGraph(boardRootPath)`

路径：

- `{root}/pages/{pageId}-object-cover.json`

行为：

- 通过 `loadPageObjectCoverIndex(...)` 读取当前页对象覆盖页索引
- 通过 `savePageObjectCoverIndex(...)` 写回对象覆盖页索引
- 文件内容为 `Array<[objectId, number[]]>`，表示对象 id 到覆盖页 id 集合的映射

### 4. 对象读取

对应 API：`loadObjects(boardRootPath)`

路径：

- `{root}/objects/page{pageId}/`

行为：

- 通过 `loadPageObjects(...)` 读取 `{root}/objects/page{pageId}/` 下对象 JSON
- 渲染侧逐个反序列化对象 JSON 并写入 `pageObjects`
- 单个对象 JSON 以 `ownerPageId` 描述对象归属页 id

### 5. 未完成项

当前已实现：

- `saveObjects(boardRootPath)`：通过 `savePageObjects(...)` 回写该页对象
- `unloadObjects()`：清理内存中的 `pageObjects`
- `unload()`：统一清理层叠图与对象映射

其中对象持久化协议遵循：

- 页目录与页层叠图路径使用页 id
- 对象 JSON 内部使用 `ownerPageId` 表示对象归属页 id
- 对象覆盖页索引使用独立页级文件保存

## Page 与文件操作关系

`Page` 本身不直接操作磁盘路径，它通过 `PageObjectManager` 间接触发文件 I/O。

关键行为：

- `loadTemp(root)`：触发 `objectManager.loadTierGraph(root)`
- `loadFull(root)`：在临时加载基础上触发 `objectManager.loadObjects(root)`

页加载策略（临时/完整）会直接影响真实文件读取量。

## 风险与约束

- 目录布局兼容：当前页目录存在嵌套目录与平铺文件并存的过渡逻辑，后续应统一。
- 写入原子性：`saveTierGraph()` 使用先删再写模式，异常中断时可能产生短时间空窗。
- 并发安全：components 层默认单进程调用，不含文件锁。
- 错误恢复：`load(...)` 遇到关键文件缺失直接抛错，调用方需要负责兜底。

## 建议演进方向

- 将 `saveTierGraph()` 迁移为 `writeJSON(...)`，减少手工序列化分支。
- 为 `pages/{pageId}` 与 `pages/{pageId}.json` 统一一套最终路径规范。
