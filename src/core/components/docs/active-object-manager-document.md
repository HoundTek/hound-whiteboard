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

这也是对象选择工具进入 modifier 链路的入口语义：

- chooser 从静态图挑出对象后，应调用 `choose(startFrom)` 将对象加入动态图
- 后续 modifier 只应修改这些已经进入 AOM 的对象
- 只要对象仍在 AOM 中，它们就不应再被重复选择

### 取消选择但不提交 `discard(objects)`

`discard` 用于取消活动对象的选择状态，但**不写回白板区块静态结构**。

典型场景是工具临时取消操作、取消选择或撤销时：

- 对象仅从动态图活动层中移除。
- 不会写回 `ChunkObjectManager`。
- 不会更新静态图中的上下关系。
- 不会刷新 base 层。

当前实现中，`discard` 会：

- 从 `activeObjects` / `activeObjectIndex` 中移除对象实例。
- 清理 `onLayer` 映射。
- 调用 `tidyup()` 清理空层和不可达层。
- 调用 `requestLiveRender()` 通知活动层重绘。
- 调用 `clearBaseObjectSnapshots()` 清理旧范围快照。

`discard` 和 `apply` 的关键区别：`discard` 不会同步静态结构，不会触发 base 层刷新，适合临时性取消选择。`apply` 则会完成完整的提交同步路径。

### 从白板删除并取消选择 `remove(objects)`

`remove` 用于从白板上彻底删除对象，并从 AOM 中取消其活动状态。它会将对象从所有覆盖区块的 `ChunkObjectManager` 静态图中移除，同时清理活动对象索引和动态图层。

当前实现中，`remove` 会：

- 收集每个对象的覆盖区块 id（合并快照记录的旧覆盖与当前几何计算的新覆盖）。
- 从所有覆盖区块中调用 `chunk.removeObject(objectId)` 移除节点、关联边和覆盖索引。
- 收集受影响的静态邻接对象，一并纳入 base 层对象级失效。
- 从 `activeObjects` / `activeObjectIndex` 中移除对象实例。
- 清理 `onLayer` 映射，调用 `tidyup()` 清理空层。
- 优先走对象级静态失效，回退到区块并集失效。
- 触发活动层重绘。
- 清理快照记录。

`remove` 与 `apply` 的关键区别：`apply` 是把活动对象写回白板静态结构，`remove` 是从白板静态结构中删除对象。

`remove` 与 `discard` 的关键区别：`discard` 仅取消活动状态，不修改白板静态结构；`remove` 会同时取消活动状态并删除白板中的对象。

`remove` 同时处理两种状态的对象：

- 当前活跃（在 AOM 中的）对象：从活动集合和区块静态图中双双移除。
- 当前不在 AOM 中的静态对象：仅从区块静态图中移除，不影响活动集合。

如果对象未挂载到白板（例如通过 `add` 加入但尚未 `apply` 的对象），`remove` 只负责取消其活动状态，不涉及区块清理。

### 提交并取消选择 `apply(objects)`

`apply` 是当前 AOM 的关键提交动作。它不再只是把对象从活动集合里删掉，而是会把活动期间的变化同步回白板区块级静态结构。

这里有一个需要单独说明的术语：对象级静态失效。

它的含义是：`apply(objects)` 完成后，base 层不再只按“哪些区块可能受影响”去重绘，而是尽量直接按“哪些静态对象对应的旧像素和新像素受影响”去生成脏区。

当前这件事分成两部分：

- AOM 在对象进入活动层时记录一份进入前的世界范围快照。
- `apply(objects)` 提交时，把对象自身以及静态图中受层级关系影响的邻接对象一起交给 `BaseRenderer.invalidateObjects(...)`，优先走对象级局部失效；只有当前 monitor 做不到对象级失效时，才退回区块级失效。

这样做的原因很直接：

- 对象移动或变形后，需要同时清掉旧静态像素和新静态像素。
- 对象层级变化时，即使几何不变，和它有静态遮挡关系的邻接对象也可能需要一起重绘。
- 如果这里始终只按区块失效，重绘范围会比真实脏区大得多，base 层增量刷新收益就会明显下降。

当前实现中，`apply` 会做几件事：

- 计算活动对象当前覆盖到的区块 id 集合。
- **从不再覆盖的旧区块 COM 中移除对象**（节点、所有关联边、覆盖索引）。
- 按覆盖区块把对象重新写回相关 `ChunkObjectManager`。
- **清除对象在所有覆盖区块静态图中的旧边**，避免对象移动或变形后残留之前的关系。
- 根据活动层顺序和对象相交关系，生成应回写到静态图的 `below/above` 关系。
  - 旧边被清除后，与当前几何不再相交的对象不会产生新边。
  - 与当前几何仍相交的静态对象（不论是否在动态图中）也会被纳入关系计算。
- 收集受影响的静态邻接对象（**合并旧覆盖区块的邻接和新区块的邻接**），一并纳入对象级静态失效。
- 请求 base 层渲染时优先走对象级局部失效，失败时退回到区块并集失效。
- 清除活动对象实例索引，并清理动态图。

关键设计点：

- **旧边在 apply 中一次性清除**，不是在每次几何变更时逐条删除。`addObject` 只做添加，不做增量边维护。
- **失效邻接对象同时覆盖新旧两侧**：旧覆盖区块的邻接在清理前通过 `previousNeighborIds` 提前收集，新区块的邻接在关系计算完成后收集，两者合并去重后一并提交。
- **未跟踪的静态对象始终参与关系计算**：`calculateStaticRelations` 的 `includeUntrackedCoveredObjectsBelow` 始终为 `true`，确保移回后的对象能重新识别与同区域静态对象的相交关系。

在当前工具链里，`apply(objects)` 不再只对应“选择后提交”：

- handoff 模式下的新建对象也会先停留在 AOM 中
- 对象修改工具收到 `apply` 信号后，会统一调用 `AOM.apply(objects)` 完成本次编辑提交

### 置顶 `liftup(objs)`

按对象来源层拆分创建新层，移除旧层中的活动对象，再将新层插入顶层，最后清理空层。

### 清理 `tidyup()`

- 删除前缀不可达层（没有活动对象的前置层）
- 删除空层
- 重建 `layerIndex`

## 快照与对象级静态失效

`apply` 中的对象级静态失效依赖一组快照机制。

### captureBaseObjectSnapshot(objects)

在对象进入活动层时，AOM 会记录一份对象进入前的世界范围快照：

- 通过 `getObjectWorldRange()` 获取对象的当前世界坐标范围。
- 将结果以 `RectangleRange` 格式存入 `baseObjectSnapshotWorldRanges` 映射表。
- 如果同一对象已有快照，则跳过（首次进入时记录一次即可）。

### clearBaseObjectSnapshots(objects)

提交完成后，清理对应对象的快照记录：

- `apply` 完成后调用，移除已提交对象的旧世界范围。
- `discard` 完成后也调用，确保取消选择后快照不会残留。

### 失效聚合

`collectBaseInvalidationObjects(objects, contexts)` 负责解析哪些对象应纳入本次 base 层局部失效。

收集来源：

1. 直接传入的活动对象实例。
2. 通过 collectStaticGraphNeighborIds() 收集每个对象
   在静态图中的邻接对象 id。
3. 通过 findBoardObjectInstance() 将这些 id 转成
   BasicObject 实例，以统一交给 BaseRenderer。

`collectStaticGraphNeighborIds(objectId, coveredChunkIds)` 的查找范围是对象所在覆盖区块的静态图：

- 对每个覆盖区块读取 `staticGraph.neighborsUnsafe(node)` 和 `predecessorsUnsafe(node)`。
- 排除自身 id。
- 返回邻接对象 id 集合。

### 请求链

`requestBaseRenderForObjects(objects, fallbackChunks)` 是 AOM 向 base 层提交失效请求的入口：

1. 优先调用 `baseRenderer.invalidateObjects(objects, { previousWorldRects })`。
2. 若对象级失效成功返回脏区：额外调用 `syncChunkBufferWithViewport()` 确保跨区块对象所在 chunk 缓冲区已同步。
3. 若对象级失效失败但有 `fallbackChunks`：退回到 `invalidateChunks()`。
4. 若连回退区块也没有：退回到 `requestViewportBaseRender()` 或 `baseRenderer.flush()`。

这意味着 AOM 不直接决定渲染策略，而是通过多级回退让 `BaseRenderer` 选择最优路径。

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

### 公开方法

| 名称                | 描述                                             | 类型                                       |
| ------------------- | ------------------------------------------------ | ------------------------------------------ |
| `add(objects)`      | 将白板外新对象加入动态图顶层                     | `(Iterable<BasicObject>) => Layer`         |
| `pickup(startFrom)` | 以起点对象集为入口，在二维覆盖区块范围内提取子图 | `(Iterable<BasicObject>) => DirectedGraph` |
| `choose(startFrom)` | 将对象集加入活动对象系统并分层                   | `(Iterable<BasicObject>) => void`          |
| `apply(objects)`    | 将活动对象按当前动态层关系提交回白板静态结构     | `(Iterable<BasicObject>) => void`          |
| `discard(objects)`  | 取消活动对象选择，不提交回白板                   | `(Iterable<BasicObject>) => void`          |
| `remove(objects)`   | 从白板区块静态图中删除对象并取消活动状态         | `(Iterable<BasicObject>) => void`          |
| `liftup(objs)`      | 将对象置顶                                       | `(Iterable<BasicObject>) => void`          |
| `tidyup()`          | 清理动态图中的无效层和空层                       | `() => void`                               |

### 渲染请求

| 名称                                                   | 描述                                   | 类型                                               |
| ------------------------------------------------------ | -------------------------------------- | -------------------------------------------------- |
| `requestLiveRender(objects)`                           | 请求所有 monitor 刷新活动层            | `(Iterable<BasicObject>) => void`                  |
| `requestBaseRender(chunks)`                            | 请求所有 monitor 刷新静态层（区块级）  | `(Iterable<Chunk>) => void`                        |
| `requestBaseRenderForObjects(objects, fallbackChunks)` | 按对象范围请求静态层刷新，支持多级回退 | `(Iterable<BasicObject>, Iterable<Chunk>) => void` |

### 快照与失效

| 名称                                                       | 描述                                   | 类型                                              |
| ---------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| `captureBaseObjectSnapshot(objects)`                       | 记录对象进入活动层前的世界范围快照     | `(Iterable<BasicObject>) => void`                 |
| `clearBaseObjectSnapshots(objects)`                        | 清理对象的静态层旧范围快照             | `(Iterable<BasicObject>) => void`                 |
| `collectBaseInvalidationObjects(objects, contexts)`        | 解析静态层对象级失效集合（含邻接对象） | `(Iterable<BasicObject>, Array) => BasicObject[]` |
| `collectStaticGraphNeighborIds(objectId, coveredChunkIds)` | 收集对象在静态图中的邻接对象 id        | `(number, Iterable<number>) => Set<number>`       |

### 关系计算

| 名称                                                                         | 描述                             | 类型                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `calculateStaticRelations(obj, coveredChunkIds, applyingObjectIds, options)` | 计算对象在静态图中的上下关系     | `(BasicObject, Set<number>, Set<number>, {includeUntrackedCoveredObjectsBelow?}) => {below, above}` |
| `calculateCoveredChunkIds(obj)`                                              | 计算对象覆盖区块集合             | `(BasicObject) => Set<number>`                                                                      |
| `intersectsObjects(left, right)`                                             | 判断两个对象是否在世界坐标中相交 | `(BasicObject, BasicObject) => boolean`                                                             |
| `collectCoveredStaticObjectIds(coveredChunkIds)`                             | 收集覆盖区块中的静态对象 id      | `(Iterable<number>) => Set<number>`                                                                 |

### 内部工具

| 名称                                                   | 描述                                          | 类型                                        |
| ------------------------------------------------------ | --------------------------------------------- | ------------------------------------------- |
| `requireObjectInstance(obj)`                           | 断言输入为 BasicObject 实例，否则抛 TypeError | `(*) => BasicObject`                        |
| `registerActiveObject(obj)`                            | 注册活动对象实例到索引                        | `(BasicObject) => void`                     |
| `unregisterActiveObject(objectId)`                     | 从活动对象索引和 onLayer 映射中移除           | `(number) => void`                          |
| `resolveObjectChunk(obj)`                              | 解析对象所属起始区块                          | `(BasicObject) => Chunk`                    |
| `createChunkBlockLoader()`                             | 创建与白板区块加载事件总线绑定的区块加载器    | `-> ChunkBlockLoader`                       |
| `getObjectWorldRange(obj)`                             | 获取对象世界坐标范围                          | `(BasicObject) => Range`                    |
| `findBoardObjectInstance(objectId, candidateChunkIds)` | 在白板全局和覆盖区块中查找对象实例            | `(number, Iterable<number>) => BasicObject` |

### 层操作

| 名称                                           | 描述                                      | 类型                         |
| ---------------------------------------------- | ----------------------------------------- | ---------------------------- |
| `insertLayerUnder(layerNow, layerAbove)`       | 将某层插入到另一层之下                    | `(Layer, Layer) => void`     |
| `insertLayerUnderById(layerNow, layerAboveId)` | 将某层插入到另一层（用 id 表示）之下      | `(Layer, number) => void`    |
| `insertLayerToTop(layerNow)`                   | 将某层插入至顶层                          | `(Layer) => void`            |
| `compareLayerOrderById(layer1, layer2)`        | 比较两层（用 id 表示）的层次顺序          | `(number, number) => number` |
| `compareLayerOrder(layer1, layer2)`            | 比较两层实例的层次顺序                    | `(Layer, Layer) => number`   |
| `purgeLayerMappings(layer)`                    | 清理给定层的 `onLayer` 映射和 `layerPool` | `(Layer) => void`            |

## 实现状态

- 已实现：核心分层逻辑、层插入与顺序比较、白板外对象 `add()`、取消选择不提交 `discard()`、从白板永久删除 `remove()`、置顶、清理、基于二维覆盖区块索引的跨区块拾取、基于对象实例的活动对象索引、`apply()` 提交回写、对象级静态失效快照与邻接对象失效聚合、多级回退的 base 层渲染请求链。
- 已验证：二维区块下的右上/左下组合移动、不可达覆盖区块跳过、覆盖区块索引更新后 `pickup` 与 `choose` 读取新结果、`pickup` 通过 `Board.createChunkBlockLoader()` 接入白板区块加载链、`add()` 将新对象注册进动态图顶层、`apply()` 回写区块对象和覆盖区块索引。
- 已接入的渲染链路：`Monitor.liveRenderer` 已可直接读取 AOM 当前活动对象集合与层顺序，并将其绘制到 `liveCanvas`；AOM 的 `requestLiveRender(...)` 现在还会同步推动 `uiCanvas` 的兼容刷新；`requestBaseRenderForObjects(...)` 已接入 `BaseRenderer.invalidateObjects` 对象级失效路径。
- 已接入的提交后静态层刷新：`apply(objects)` 完成静态结构写回后，会优先走对象级静态失效，把对象旧范围、新范围以及受静态层级变化影响的邻接对象一起送入 `BaseRenderer.invalidateObjects(...)`；无法走对象级路径时，才退回区块并集失效。
- 已接入的高频修改路径：creator 工具已会在对象几何变更前记录旧几何快照，并在变更后调用 `monitor.liveRenderer.invalidateObjects(...)` 请求活动层刷新；creator 与 modifier 的高频几何修改路径现在也会同步请求 ui 层刷新，使兼容选择框能及时重绘。
- 当前实现里，AOM 只负责推动 ui 层刷新，不再直接决定默认选择框出现时机；默认选择框来源已收口到 chooser / modifier 工具主动声明的 overlay，工具内部当前可复用自己的节点上下文。
- 待完善：对象级 dirty rect 仍未覆盖完整对象族；跨区块高频移动下的脏区裁剪与性能优化仍待推进；`collectBaseInvalidationObjects` 的邻接对象查找路径仍依赖全量覆盖区块静态图遍历，在覆盖区块跨度过大时可能成为性能瓶颈。

## 相关文档

- [tier-graph-document.md](./tier-graph-document.md)
- [chunk-document.md](./chunk-document.md)
- [chunk-object-manager-document.md](./chunk-object-manager-document.md)
- [chunk-block-loader-document.md](./chunk-block-loader-document.md)
