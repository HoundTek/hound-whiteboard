# 活动对象管理器文档

本文档提供 `ActiveObjectManager` 的概述。

活动对象管理器用于管理“正在被选择或正在被操作”的对象集合，并维护它们在交互过程中的动态层关系。

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

该流程对应 [tire-graph-document.md](./tire-graph-document.md) 中“选择单个/多个对象”章节。

### 取消选择 `remove(objs)`

将对象从 `activeObjects` 和对应层的 `activeObjects` 中删除，然后执行 `tidyup()` 清理空层。

### 置顶 `liftup(objs)`

按对象来源层拆分创建新层，移除旧层中的活动对象，再将新层插入顶层，最后清理空层。

### 清理 `tidyup()`

- 删除前缀不可达层（没有活动对象的前置层）
- 删除空层
- 重建 `layerIndex`

## 跨页拾取与临时加载

`pickup` 支持跨页遍历对象图；`PageLoadManager` 在遍历过程中负责：

- 控制临时加载页数量上限（默认 4）
- 左右翻页时按需加载/卸载页层叠图

当前 `PageLoadManager` 的文件加载路径仍是占位 `todo`，但接口已固定。

## API

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `choose(startFrom)` | 将对象集加入活动对象系统并分层 | `Set<{id: number, page: PageManager}> -> void` |
| `remove(objs)` | 取消选择对象 | `Set<number> -> void` |
| `liftup(objs)` | 将对象置顶 | `Set<number> -> void` |
| `tidyup()` | 清理动态图中的无效层和空层 | `void -> void` |

## 实现状态

- 已实现：核心分层逻辑、层插入与顺序比较、取消选择、置顶、清理。
- 待完善：跨页加载文件路径、更多边界情况校验、性能优化（跨页高频移动时）。

## 相关文档

- [tire-graph-document.md](./tire-graph-document.md)
- [page-manager-document.md](./page-manager-document.md)
- [page-object-manager-document.md](./page-object-manager-document.md)
