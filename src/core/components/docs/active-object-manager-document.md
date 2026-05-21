# 活动对象管理器文档

本文档提供 `ActiveObjectManager` 的概述。

活动对象管理器用于管理“正在被选择或正在被操作”的对象集合，并维护它们在交互过程中的动态层关系。

`ActiveObjectManager` 会把对象视为位于无限二维白板上的节点，并通过区块级覆盖索引在二维区块网格上拾取相关子图。

## 何为活动对象

活动对象是当前交互焦点对象。典型场景包括：

- 框选后的一组对象
- 正在绘制或修改的对象
- 正在拖拽的对象

在 Core 中，活动对象由白板全局统一管理，不分区块入口。

## 核心数据结构

### Layer

`Layer` 用于表示动态状态图中的一层，包含：

- `id`：层编号
- `activeObjects`：本层活动对象 id 集合
- `inactiveGraph`：本层非活动对象子图

### ActiveObjectManager

主要字段：

- `layerPool`：层 id 池
- `layerOrder`：层顺序数组
- `layerIndex`：层 id 到索引映射
- `onLayer`：对象 id 到其所在层映射
- `activeObjects`：当前活动对象实例集合
- `activeObjectIndex`：活动对象 id 到实例的索引

这里有一个明确分工：

- 活动对象在 AOM 顶层以实例管理，便于后续提交时直接读取对象几何、归属区块和覆盖范围。
- 层和区块静态图中的非活动对象仍以 id 管理，避免把整区块对象实例都搬进动态图结构里。

这里还要补一个当前实现中的渲染边界：

- AOM 负责回答“哪些对象当前是活动对象，它们的层次顺序是什么”。
- `Monitor` / `LiveRenderer` 负责回答“这些活动对象何时刷新，以及画到哪一层 canvas 上”。

也就是说，AOM 持有交互态语义，但不直接承担视口渲染职责。

## 主要流程

### 加入白板外对象 `add(objects)`

`add` 用于把“尚未写入白板区块静态结构”的新对象注册进 AOM。

典型场景是对象创建刚开始时：

- creator 首次真正创建出对象实例。
- 此时对象还不应直接写回区块静态图。
- AOM 先把它加入动态图顶层，使它在创建过程里成为活动对象。

当前实现中，`add` 会：

- 注册对象实例到 `activeObjects` 和 `activeObjectIndex`。
- 为这些新对象创建一个新的顶层活动层。
- 将对象 id 记入该层的 `activeObjects`。

它不负责：

- 立即写回区块静态图。
- 立即生成静态图上下关系。
- 立即保存对象覆盖区块索引到磁盘。

这些动作会在后续 `apply(objects)` 中统一完成。

### 选择对象 `choose(startFrom)`

1. 通过 `pickup(startFrom)` 提取以活动对象为起点的子图。
2. 计算每个节点所在层索引。
3. 构造新层并处理与旧层的相对顺序约束。
4. 插入新层到 `layerOrder`。

该流程对应 [tier-graph-document.md](./tier-graph-document.md) 中“选择单个/多个对象”章节。

这里的关键点是：`choose` 本身不负责判断对象跨越了哪些区块。它完全依赖 `pickup` 产出的子图，而 `pickup` 又完全依赖各区块 `ChunkObjectManager.objectCoverChunks` 中的当前索引。

当前接口已经收敛为“对象实例驱动”：

- 调用方传入 `BasicObject` 实例集合。
- AOM 通过对象自身的 `ownerChunkId` 去向白板解析起始区块。

### 提交并取消选择 `apply(objects)`

`apply` 是当前 AOM 的关键提交动作。它不再只是把对象从活动集合里删掉，而是会把活动对象重新写回白板区块级结构。

当前实现中，`apply` 会做几件事：

- 计算活动对象当前覆盖到的区块 id 集合。
- 按覆盖区块把对象重新写回相关 `ChunkObjectManager`。
- 根据活动层顺序和对象相交关系，生成应回写到静态图的 `below/above` 关系。
- 清除活动对象实例索引，并清理动态图。

### 置顶 `liftup(objs)`

按对象来源层拆分创建新层，移除旧层中的活动对象，再将新层插入顶层，最后清理空层。

### 清理 `tidyup()`

- 删除前缀不可达层（没有活动对象的前置层）
- 删除空层
- 重建 `layerIndex`

## 跨区块拾取与二维区块遍历

`pickup(startFrom)` 的职责是：从若干起点对象开始，沿静态层叠图向下游提取一个可达子图；如果某对象覆盖多个区块，则还要继续读取这些覆盖区块上的同名节点邻接关系。

在当前实现中，它的跨区块行为有几个约束：

- 起点优先是对象实例集合；AOM 会先取对象 id，再通过对象自身的 `ownerChunkId` 解析起始区块。
- 当 AOM 被挂在 `Board` 上时，会优先使用 `Board.createChunkBlockLoader()`，因此跨区块拾取会自动接入白板区块加载事件总线。
- 对某个节点是否跨区块，读取 `chunk.objectManager.getObjectCoverChunks(node)`。
- 覆盖区块用区块 id 描述，再通过 `Chunk.idToCoordinate(chunkId)` 转成二维坐标。
- `ChunkBlockLoader` 会在二维坐标系中按需移动：先处理 x 方向，再处理 y 方向；因此同一次拾取中可以出现右上、左下这类组合路径。
- 读取某个覆盖区块完成后，`pickup` 会把 `ChunkBlockLoader` 移回原区块，再继续处理剩余覆盖区块，避免把 DFS 的后续搜索留在错误区块上下文里。
- 如果某个覆盖区块当前不可达，`pickup` 会跳过该区块，继续处理其它覆盖区块，不会让整次拾取失败。

这意味着：

- `pickup` 的结果对 `objectCoverChunks` 是实时敏感的。
- 只要对象几何形态变化后有人及时刷新覆盖区块索引，AOM 下一次 `pickup` / `choose` 就会自动读取到新结果。
- 如果修改路径没有刷新索引，AOM 仍会工作，但读取到的是旧覆盖区块信息。

## API

| 名称                | 描述                                           | 类型                                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------- |
| `add(objects)`      | 将白板外新对象加入动态图顶层                   | `Iterable<BasicObject> -> Layer`         |
| `pickup(startFrom)` | 以起点对象集为入口，在二维覆盖区块范围内提取子图 | `Iterable<BasicObject> -> DirectedGraph` |
| `choose(startFrom)` | 将对象集加入活动对象系统并分层                 | `Iterable<BasicObject> -> void`          |
| `apply(objects)`    | 将活动对象按当前动态层关系提交回白板静态结构   | `Iterable<BasicObject> -> void`          |
| `liftup(objs)`      | 将对象置顶                                     | `Iterable<BasicObject> -> void`          |
| `tidyup()`          | 清理动态图中的无效层和空层                     | `void -> void`                           |

## 实现状态

- 已实现：核心分层逻辑、层插入与顺序比较、白板外对象 `add()`、置顶、清理、基于二维覆盖区块索引的跨区块拾取、基于对象实例的活动对象索引、`apply()` 提交回写。
- 已验证：二维区块下的右上/左下组合移动、不可达覆盖区块跳过、覆盖区块索引更新后 `pickup` 与 `choose` 读取新结果、`pickup` 通过 `Board.createChunkBlockLoader()` 接入白板区块加载链、`add()` 将新对象注册进动态图顶层、`apply()` 回写区块对象和覆盖区块索引。
- 已接入的渲染链路：`Monitor.liveRenderer` 已可直接读取 AOM 当前活动对象集合与层顺序，并将其绘制到 `liveCanvas`。
- 待完善：修改工具链在对象几何变化后自动触发 `renderScheduler.invalidate(...)`、将活动层刷新从整层重绘推进到 dirty rect，以及跨区块高频移动时的性能优化。

## 相关文档

- [tier-graph-document.md](./tier-graph-document.md)
- [chunk-document.md](./chunk-document.md)
- [chunk-object-manager-document.md](./chunk-object-manager-document.md)
- [chunk-block-loader-document.md](./chunk-block-loader-document.md)
