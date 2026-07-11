# 活动对象管理器文档

本文档提供 `ActiveObjectManager` 的概述。

## 概述

`ActiveObjectManager`（AOM）管理“当前处于交互态”的对象集合与临时层关系。

典型来源包括：

- creator 刚创建但尚未提交的对象
- chooser 选中的对象
- modifier 正在编辑的对象

AOM 本身不依赖 DOM，也不直接持有 viewport 列表。它通过 `renderHooks` 把渲染副作用注入到调用方，因此既能在测试环境使用，也能在 Worker 中作为真实语义核心运行。

## 运行边界

- **Worker 模块**：AOM 是纯 Worker 侧模块，真实实例位于 Worker 的 `BoardCore` 中
- **UI（测试/兼容）**：本地 `BoardCore` 在测试路径中仍创建 AOM 实例，但 UI 侧的 `Board` facade 不直接持有 AOM，`UiRenderer` 也不引用 AOM

## 核心数据结构

### `Layer`

每层包含：

- `id`
- `activeObjects: Set<number>`
- `inactiveGraph: DirectedGraph`
- `active: boolean`

这里的 `active` 是层级状态，不是对象级状态。

### `ActiveObjectManager`

核心字段：

- `layerOrder`
- `layerIndex`
- `onLayer`
- `activeObjectIndex`
- `baseObjectSnapshotWorldRanges`
- `baseObjectSnapshotCoverChunks`
- `renderHooks`

## API 一览

### 公开方法

| 方法      | 签名                                                     | 说明                                                |
| --------- | -------------------------------------------------------- | --------------------------------------------------- |
| `has`     | `(objectId: number) => boolean`                          | 判断对象 id 是否在 AOM 的任意层中（含 inactive 层） |
| `add`     | `(objects: Iterable<BasicObject>) => Layer \| undefined` | 将白板外新对象加入 AOM 顶层，返回新创建的层         |
| `choose`  | `(startFrom: Iterable<BasicObject>) => Promise<void>`    | 从静态图中拾取对象到 AOM（异步，内部 BFS 遍历）     |
| `discard` | `(objects: Iterable<BasicObject>) => void`               | 取消活动态，不提交几何变化回静态图                  |
| `apply`   | `(objects: Iterable<BasicObject>) => Promise<void>`      | 提交活动态变化回静态图（异步，含 FullLoad 预加载）  |
| `remove`  | `(objects: Iterable<BasicObject>) => void`               | 从白板彻底删除对象并移出 AOM                        |

### 私有方法

所有私有方法均标记 `@private`，不构成公开契约。关键私有方法速览：

| 方法                                                                          | 说明                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pickup(startFrom)`                                                           | 提取以指定对象集合为起点的子图（BFS 双队列），供给 `choose` 内部使用 |
| `deactivateObjects(objects)`                                                  | 将一组活动对象失活，必要时整层标记 inactive                          |
| `tidyup()`                                                                    | 清理最底层 inactive 层及空层，失活层对象写入静态图                   |
| `captureBaseObjectSnapshot(objects)`                                          | 记录对象进入 AOM 前的世界范围快照                                    |
| `captureBaseObjectCoverChunks(objects)`                                       | 记录对象进入 AOM 前的覆盖区块快照                                    |
| `clearBaseObjectSnapshots(objects)`                                           | 清理快照                                                             |
| `registerActiveObject(obj)`                                                   | 将对象实例注册到活动索引                                             |
| `unregisterTrackedActiveObject(objectId)`                                     | 从活动索引移除对象                                                   |
| `findBoardObjectInstance(objectId, candidateChunkIds?)`                       | 在 AOM 和 BoardCore 中查找对象实例                                   |
| `getObjectWorldRange(obj)`                                                    | 获取对象世界坐标范围                                                 |
| `calculateCoveredChunkIds(obj)`                                               | 计算对象覆盖区块集合                                                 |
| `resolveObjectChunk(obj)`                                                     | 解析对象所在的起始区块                                               |
| `calculateStaticRelations(obj, coveredChunkIds, applyingObjectIds, options?)` | 计算对象在静态图中的上下关系                                         |
| `collectStaticGraphNeighborIds(objectId, coveredChunkIds?)`                   | 收集静态图中某对象的邻接对象 id                                      |
| `collectBaseInvalidationObjects(objects, contexts?)`                          | 解析静态层对象级失效集合                                             |
| `intersectsObjects(left, right)`                                              | 判断两个对象世界范围是否相交                                         |
| `collectCoveredStaticObjectIds(coveredChunkIds)`                              | 收集覆盖区块中的静态对象 id                                          |
| `collectLayerSemanticInactiveObjectIds(layer)`                                | 收集某层按 inactive 语义参与计算的对象 id                            |
| `updateLayerActiveState(layer)`                                               | 按当前活动索引刷新层的 active 状态                                   |
| `removeObjectFromLayerStorage(layer, objectId)`                               | 从给定层的结构中移除对象 id                                          |
| `removeObjectFromLayer(objectId)`                                             | 从对象所在层移除对象 id                                              |
| `purgeLayerMappings(layer)`                                                   | 清理层的 onLayer 映射与 layerPool                                    |
| `insertLayerUnderById(layerNow, layerAboveId?)`                               | 将层插入到指定层之下                                                 |
| `insertLayerToTop(layerNow)`                                                  | 将层插入到顶层                                                       |
| `compareLayerOrderById(layer1, layer2)`                                       | 比较两层的层次顺序                                                   |
| `requestActiveRender(objects)`                                                | 通过 renderHooks 请求活动层刷新                                      |
| `requestStaticRender(chunks)`                                                 | 通过 renderHooks 请求静态层刷新                                      |
| `requestStaticRenderForObjects(objects, fallbackChunks?)`                     | 按对象范围请求静态层刷新                                             |
| `createChunkLoader()`                                                         | 创建绑定到 BoardCore 的 ChunkLoader                                  |
| `destroyChunkLoader(loader)`                                                  | 销毁 ChunkLoader                                                     |
| `requireObjectInstance(obj)`                                                  | 断言输入是 BasicObject 实例                                          |

## AOM 与静态图的边界

### 静态图

- 各区块的 `ChunkObjectManager.staticGraph`
- 稳定层叠关系
- 对象提交回白板后由 static graph 接管显示

### 动态图

- AOM 内部的 `layerOrder + activeObjects + inactiveGraph`
- 只在交互期间存在
- 对象位于 AOM 中时，应由 active 层负责绘制

这两者的切换由：

- `add(objects)`
- `choose(objects)`
- `discard(objects)`
- `apply(objects)`
- `remove(objects)`

共同完成。

## renderHooks

AOM 当前通过 `renderHooks` 发起渲染请求：

- `requestActiveRender(objectInstances)`
- `requestStaticRender(chunks)`
- `requestStaticRenderForObjects(objectInstances, fallbackChunks, previousWorldRects)`
- `flushViewportForObjects(objectInstances)`

### Worker mode

在 Worker mode 下：

- `BoardCore` 注入的 hooks 最终驱动 `ViewportCore` 的 static/active 渲染
- AOM 自身不关心 DOM canvas

### UI（测试/兼容）

在测试路径下：

- `Board` 注入的 `board-render-hooks` 直接驱动本地 `BoardCore` 渲染器

## 主要流程

### `add(objects)`

用于把**尚未进入白板静态图**的新对象加入 AOM。

典型场景：creator 开始创建对象。

执行效果：

1. 注册到 `activeObjects` / `activeObjectIndex`
2. 创建新的顶层活动层
3. 调用 `requestActiveRender()`

> ⚠️ 当前实现在此步骤也调用了 `requestStaticRenderForObjects()`，但由于对象此前从未进入静态图，base 层无对应像素需要隐藏，该调用是多余的。[todo] 移除。

### `pickup(startFrom)`

（`choose` 的内置步骤，不在 AOM 公开接口列表中）

用于提取以指定对象集合为起点的子图。

采用双队列 BFS 逐层遍历：

- `loadedQueue`：区块已加载的待处理节点
- `pendingQueue`：区块未加载的待处理节点

先耗尽 `loadedQueue`，攒够 `pendingQueue` 后统一以 `Promise.all` **批量 TempLoad** 所有未加载区块，再移入 `loadedQueue` 继续处理。

- 常见情况（视口内区块均已加载）：`pendingQueue` 始终为空，零加载开销
- 跨区块穿越时：同一层发现的新区块并行加载，不串行等待
- 队列元素携带各自所属的 chunk 引用，无全局可变状态

返回 `Promise<DirectedGraph>`。

### `choose(startFrom)`

用于把静态图中的对象拾取到 AOM。

执行效果：

1. `pickup(startFrom)` 提取子图（异步，内部 BFS 遍历）
2. 分析层顺序并插入新层
3. 注册活动对象实例
4. 调用 `requestActiveRender()`
5. 调用 `requestStaticRenderForObjects()`，使 base 层按对象范围把这些对象隐藏

返回 `Promise<void>`。

### `discard(objects)`

用于取消活动态，但不把几何变化提交回静态图。

执行效果：

1. 从活动对象索引中移除对象
2. 必要时把层标记为 inactive
3. `tidyup()` 清理底部 inactive 前缀层与空层
4. 调用 `requestStaticRenderForObjects()`，使静态层重新显示这些对象
5. 调用 `requestActiveRender()`
6. 清理快照

### `apply(objects)`

用于把活动态变化提交回静态图。

执行效果：

1. 遍历待提交对象，计算它们覆盖的所有区块
2. 通过 ChunkLoader 以 `Promise.all` **批量 FullLoad** 这些区块（含 `syncChunkObjectEntries`，确保对象实例从磁盘读到内存）
3. 根据覆盖区块快照与当前几何重写对象所在区块
4. 重算受影响对象的静态图关系（此时已有完整的历史对象实例）
5. 收集邻接对象，形成对象级 base 失效集合
6. 调用 `requestStaticRenderForObjects()`
7. 调用 `requestActiveRender()`
8. 清理快照并移出活动索引

返回 `Promise<void>`。

### `remove(objects)`

用于从白板彻底删除对象，并同步移出 AOM。

## 快照模型

AOM 用两类快照支持对象级静态失效：

### `baseObjectSnapshotWorldRanges`

记录对象进入 AOM 前的世界范围。

### `baseObjectSnapshotCoverChunks`

记录对象进入 AOM 前覆盖到的区块集合。

这两类快照让 `apply` / `discard` / `remove` 能同时失效旧几何与新几何，避免静态层残影。

## 与 tools 的关系

### creator

- `add()` 让新对象先停留在 AOM 动态图中
- handoff 模式下对象可继续桥接给 modifier

### chooser

- `choose()` 把静态对象拾取进 AOM
- 选中的对象成为 modifier 的输入来源

### modifier

- 只编辑当前仍在 AOM 中的对象
- `success` 最终走 `apply()`
- `cancel` 走 `discard()`

## 当前状态

- AOM 作为 Worker 侧真实语义核心运行
- `choose` / `discard` / `apply` / `remove` 全部支持对象级静态失效
- 渲染副作用通过 hooks 抽离
- `pickup` 采用双队列 BFS + 批量 TempLoad，已加载区块零开销，未加载区块并行加载
- `apply` 提交前 FullLoad 所有相关区块，确保层叠关系计算正确
- `objectCoverChunks` 集中在 `BoardCore` 统一管理

## 相关文档

- [board-document.md](../../../../ui/components/orchestration/docs/board-document.md)
- [viewport-document.md](../../../../ui/components/orchestration/docs/viewport-document.md)
- [ui-renderer-document.md](../../../../ui/components/renderer/docs/ui-renderer-document.md)
- [core-runtime-boundaries.md](../../../../docs/core-runtime-boundaries.md)
