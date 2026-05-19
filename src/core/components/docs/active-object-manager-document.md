# 活动对象管理器文档

本文档提供 `ActiveObjectManager` 的概述。

活动对象管理器用于管理“正在被选择或正在被操作”的对象集合，并维护它们在交互过程中的动态层关系。

`ActiveObjectManager` 会把对象视为位于无限二维白板上的节点，并通过页级覆盖索引在二维页网格上拾取相关子图。

## 何为活动对象

活动对象是当前交互焦点对象。典型场景包括：

- 框选后的一组对象
- 正在绘制或修改的对象
- 正在拖拽的对象

在 Core 中，活动对象由白板全局统一管理，不分页面入口。

## 核心数据结构

### Layer

`Layer` 用于表示动态状态图中的一层，包含：

- `id`：层编号
- `activeObjects`：本层活动对象集合
- `inactiveGraph`：本层非活动对象子图

### ActiveObjectManager

主要字段：

- `layerPool`：层 id 池
- `layerOrder`：层顺序数组
- `layerIndex`：层 id 到索引映射
- `onLayer`：对象 id 到其所在层映射
- `activeObjects`：当前活动对象 id 集合

## 主要流程

### 选择对象 `choose(startFrom)`

1. 通过 `pickup(startFrom)` 提取以活动对象为起点的子图。
2. 计算每个节点所在层索引。
3. 构造新层并处理与旧层的相对顺序约束。
4. 插入新层到 `layerOrder`。

该流程对应 [tier-graph-document.md](./tier-graph-document.md) 中“选择单个/多个对象”章节。

这里的关键点是：`choose` 本身不负责判断对象跨越了哪些页。它完全依赖 `pickup` 产出的子图，而 `pickup` 又完全依赖各页 `PageObjectManager.objectCoverPages` 中的当前索引。

### 取消选择 `remove(objs)`

将对象从 `activeObjects` 和对应层的 `activeObjects` 中删除，然后执行 `tidyup()` 清理空层。

### 置顶 `liftup(objs)`

按对象来源层拆分创建新层，移除旧层中的活动对象，再将新层插入顶层，最后清理空层。

### 清理 `tidyup()`

- 删除前缀不可达层（没有活动对象的前置层）
- 删除空层
- 重建 `layerIndex`

## 跨页拾取与二维页遍历

`pickup(startFrom)` 的职责是：从若干起点对象开始，沿静态层叠图向下游提取一个可达子图；如果某对象覆盖多个页，则还要继续读取这些覆盖页上的同名节点邻接关系。

在当前实现中，它的跨页行为有几个约束：

- 起点是 `Set<{id, page}>`，因此 AOM 始终从“对象 id + 当前所在页实例”开始，而不是只靠对象 id 全局检索。
- 对某个节点是否跨页，不看方向字段，不看旧式 left/right spill，而是读取 `page.objectManager.getObjectCoverPages(node)`。
- 覆盖页用页 id 描述，再通过 `Page.idToCoordinate(pageId)` 转成二维坐标。
- `PageLoader` 会在二维坐标系中按需移动：先处理 x 方向，再处理 y 方向；因此同一次拾取中可以出现右上、左下这类组合路径。
- 读取某个覆盖页完成后，`pickup` 会把 `PageLoader` 移回原页，再继续处理剩余覆盖页，避免把 DFS 的后续搜索留在错误页上下文里。
- 如果某个覆盖页当前不可达，`pickup` 会跳过该页，继续处理其它覆盖页，不会让整次拾取失败。

这意味着：

- `pickup` 的结果对 `objectCoverPages` 是实时敏感的。
- 只要对象几何形态变化后有人及时刷新覆盖页索引，AOM 下一次 `pickup` / `choose` 就会自动读取到新结果。
- 如果修改路径没有刷新索引，AOM 仍会工作，但读取到的是旧覆盖页信息。

## API

| 名称                | 描述                                           | 类型                                             |
| ------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `pickup(startFrom)` | 以起点对象集为入口，在二维覆盖页范围内提取子图 | `Set<{id: number, page: Page}> -> DirectedGraph` |
| `choose(startFrom)` | 将对象集加入活动对象系统并分层                 | `Set<{id: number, page: Page}> -> void`          |
| `remove(objs)`      | 取消选择对象                                   | `Set<number> -> void`                            |
| `liftup(objs)`      | 将对象置顶                                     | `Set<number> -> void`                            |
| `tidyup()`          | 清理动态图中的无效层和空层                     | `void -> void`                                   |

## 实现状态

- 已实现：核心分层逻辑、层插入与顺序比较、取消选择、置顶、清理、基于二维覆盖页索引的跨页拾取。
- 已验证：二维页下的右上/左下组合移动、不可达覆盖页跳过、覆盖页索引更新后 `pickup` 与 `choose` 读取新结果。
- 待完善：修改工具链在对象几何变化后自动刷新覆盖页索引，以及跨页高频移动时的性能优化。

## 相关文档

- [tier-graph-document.md](./tier-graph-document.md)
- [page-document.md](./page-document.md)
- [page-object-manager-document.md](./page-object-manager-document.md)
- [page-loader-document.md](./page-loader-document.md)
