# 页面对象管理器文档

本文档提供 `PageObjectManager` 的概述。

`PageObjectManager` 负责管理单页内对象数据与对象层叠关系（静态图），是页级数据读写与层关系维护的核心组件。

## 何为页面对象管理

页面对象管理包含两部分：

1. 本页对象实例映射（拥有对象实例所有权）
2. 本页对象层叠关系图（仅存对象 id 关系）

这两部分相互配合：

- 图决定对象间遮挡/上下文关系
- 对象映射决定对象本身内容（几何、样式、渲染属性）

## 核心字段

| 名称               | 描述               | 类型                       |
| ------------------ | ------------------ | -------------------------- |
| `staticGraph`      | 页静态层叠图       | `DirectedGraph`            |
| `objectCoverPages` | 对象覆盖页 id 索引 | `Map<number, Set<number>>` |
| `pageObjects`      | 页对象映射         | `Map<number, BasicObject>` |

其中：

- `staticGraph` 记录本页可见的对象层叠关系
- `objectCoverPages` 记录“某对象覆盖到哪些页 id”
- `pageObjects` 保存本页拥有所有权的对象实例

对象持久化时，页描述也统一使用页 id：

- 页自身通过 `pageId` 决定目录与层叠图文件位置
- 对象 JSON 内通过 `ownerPageId` 表示该对象归属哪一页
- 对象覆盖页索引通过独立文件 `{root}/pages/{pageId}-object-cover.json` 保存

当前实现已经可以基于对象自身的 `Range` 计算覆盖页：

- 先取对象主判定范围 `obj.getRange()`
- 再叠加对象位置得到世界坐标范围
- 然后与候选页矩形逐一做 range 相交判断
- 最终得到精确的覆盖页 id 集合

这份索引不是只给持久化层使用。当前 `ActiveObjectManager.pickup(...)` 会直接读取 `objectCoverPages` 来决定跨哪些页继续拾取，所以它既是页级缓存索引，也是运行时行为索引。

因此这里有一条关键约束：

- 对象创建完成后，应立即为该对象建立覆盖页索引。
- 对象几何范围发生变化后，应刷新该对象的覆盖页索引。
- 如果运行时索引落后于对象真实几何，AOM 的跨页拾取和分层都会读取到旧覆盖范围。

## 层叠图接口

### `loadTierGraph(boardRootPath)`

通过 components 专用 IPC 桥从主进程读取层叠图并反序列化：

- 输入结构由 `DirectedGraph.parse(...)` 处理
- 同时读取独立的对象覆盖页索引文件
- 当前实现会直接替换 `staticGraph` 与 `objectCoverPages`

### `saveTierGraph(boardRootPath)`

通过专用 IPC 桥持久化静态图与对象覆盖页索引。

### `unloadTierGraph()`

释放静态图引用，供临时页卸载使用。

## 对象读写接口

- `loadObjects(boardRootPath)`：通过专用 IPC 桥加载本页对象
- `saveObjects(boardRootPath)`：通过专用 IPC 桥保存本页对象
- `unloadObjects()`：释放对象实例
- `unload()`：统一卸载层叠图与对象实例

## API

| 名称                                                        | 描述                           | 类型                                             |
| ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------ |
| `setObjectCoverPages(objectId, pageIds)`                    | 设置对象覆盖页 id 集合         | `number -> Iterable<number> -> void`             |
| `getObjectCoverPages(objectId)`                             | 获取对象覆盖页 id 集合         | `number -> Set<number>`                          |
| `serializeObjectCoverPages()`                               | 序列化对象覆盖页索引           | `void -> Array<[number, number[]]>`              |
| `syncObjectCoverPagesForObject(obj, pageWidth, pageHeight)` | 基于对象 range 重算覆盖页      | `BasicObject -> number -> number -> Set<number>` |
| `syncAllObjectCoverPages(pageWidth, pageHeight)`            | 重建当前页全部对象的覆盖页索引 | `number -> number -> Map<number, Set<number>>`   |
| `loadTierGraph(boardRootPath)`                              | 加载页层叠图                   | `string -> Promise<void>`                        |
| `saveTierGraph(boardRootPath)`                              | 保存页层叠图                   | `string -> Promise<void>`                        |
| `unloadTierGraph()`                                         | 卸载页层叠图                   | `void -> void`                                   |
| `loadObjects(boardRootPath)`                                | 加载页对象                     | `string -> Promise<void>`                        |
| `saveObjects(boardRootPath)`                                | 保存页对象                     | `string -> Promise<void>`                        |
| `unloadObjects()`                                           | 卸载页对象                     | `void -> void`                                   |
| `unload()`                                                  | 卸载本页全部数据               | `void -> void`                                   |

## 与其它组件的关系

- 被 [page-document.md](./page-document.md) 持有并调度。
- 其静态图与 `objectCoverPages` 都会被 [active-object-manager-document.md](./active-object-manager-document.md) 的跨页拾取逻辑读取。
- 底层依赖 `src/core/utils/directed-graph.js`。

## 实现状态

- 已实现：数据结构定义、按页 id 的对象覆盖索引、层叠图加载/保存、对象读写、统一卸载入口、基于 `Range` 的精确覆盖页计算。
- 已接线：对象创建完成后可建立 owner page 上的对象记录与覆盖页索引。
- 待完善：对象修改/删除/归属页迁移路径上的覆盖页索引自动刷新，以及对象增量落盘策略与更细粒度错误恢复。
