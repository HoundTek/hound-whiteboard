# Core 数据模型与术语统一

本文档整理 `src/core/engine/` + `src/core/ui-thread/` + `src/core/bridges/` 当前实现中的核心数据模型，并明确 UI 线程、Worker 与 Engine 核心层之间的权威边界。

## 数据权威划分

### UI 线程

UI 线程持有：

- `Board`
- `DevicesDAG`
- `signalsEventBus`
- `Viewport`
- tools / prefixes / devices
- 工具链中的轻量对象条目（creator `_entry`、chooser / modifier 条目）

这些对象主要服务于输入编排、局部交互和 UI overlay，不是最终对象与区块权威。

### Worker 线程

Worker 线程持有真正的 Core 数据权威：

- `BoardCore`
- `ViewportCore`
- `ActiveObjectManager`
- `Chunk` / `ChunkLoader` / `ChunkObjectManager`
- Worker 侧 base/live 渲染器
- `UndoTree`

### Shared 纯模型层

UI 与 Worker 共用：

- `engine/objects/`
- `engine/range/`
- `engine/renderer/`
- `engine/types/`
- `engine/utils/`

## 白板级模型

### `Board`

`Board` 是 UI 侧白板 facade，负责：

- 持有唯一 `DevicesDAG`
- 持有 `signalsEventBus`
- 管理 `viewports`
- 通过 `BoardApiRpc` 与 Worker 通信
- 通过本地 `CounterPool` 同步分配 `objectId`

### `BoardCore`

`BoardCore` 是 Worker 侧真实白板状态，关键字段包括：

- `width` / `height`
- `rootPath`
- `undoTree`
- `chunkLoaded`
- `objectLoaded`
- `chunkLoadEventBus`
- `rootChunkLoader`
- `persistenceAdapter`
- `aomRenderHooks`
- `activeObjectManager`
- `#objectCoverChunks`

在当前实现里，真正的对象、区块与提交关系都以 Worker 中的 `BoardCore` 为准。

## objectId 模型

当前 `objectId` 分配规则：

1. UI 工具通过 `Board.allocateObjectId()` 申请 id
2. `Board` 使用本地 `CounterPool` 同步递增
3. `BoardApiRpc.createObject(type, { id, ... })` 把显式 id 发往 Worker
4. Worker 校验重复 id 后创建对象并加入 AOM

这意味着：

- UI 线程是 **id 分配者**
- Worker 线程是 **id 校验者与使用者**
- `BoardCore` 当前不负责自动分配 id

## 区块级模型

### `Chunk`

单个区块的运行时实体，包含：

- 区块二维坐标与区块 id
- `objectManager: ChunkObjectManager`
- 加载状态与邻接关系

### `ChunkObjectManager`

区块对象管理器，负责：

- `staticGraph`：区块内静态层叠图
- 覆盖区块索引的同步与序列化
- 区块元数据的加载 / 保存

当前覆盖区块索引的权威副本集中在 `BoardCore.#objectCoverChunks`。`ChunkObjectManager` 有 `board` 时会委托给 `BoardCore`，只有无 `board` 的局部测试场景才回退到本地存储。

### `chunkLoaded`

`BoardCore.chunkLoaded` 的值结构可概括为：

```js
Map<chunkId, {
  chunk,
  tempLoadedCount,
  fullLoadedCount,
  loaderStrategy,
}>
```

它表示区块当前被哪些加载器以何种策略持有，而不是对象几何本身。

## 对象级模型

### 真实对象实例

真实对象实例定义在 `engine/objects/`，基类是 `BasicObject`，再派生出笔画、容器、一维/二维图形等对象类型。

统一字段主要包括：

- `id`
- `position`
- `transform`
- `property`
- `data`
- `rich`

### 轻量对象条目（`LightweightObjectEntry`）

`LightweightObjectEntry` 定义在 `src/core/engine/types/types.js`。

它是 UI 工具链里传递对象信息的统一纯数据协议：

```js
{
  id: number,
  type: string,
  position: Vector | { x, y },
  boundingBox?: RectangleRange,
  range?: Range,
  property: Record<string, any>,
  data: Record<string, any>,
}
```

当前主要有两类场景：

| 场景   | 来源                                     | 特征                                                           |
| ------ | ---------------------------------------- | -------------------------------------------------------------- |
| 创建态 | creator `_entry`                         | `position` 往往是 `Vector`，通常还没有 `range` / `boundingBox` |
| 摘要态 | `queryObjects()` / `hitTest()` / handoff | `position` 是纯对象快照，并附带 `range` / `boundingBox`        |

消费端通常通过 `Vector.parse()` 之类的逻辑统一处理两种 `position` 形态。

### `ObjectSummary`

跨线程查询返回的对象摘要同样定义在 `engine/types/types.js`，通常包含：

- `id`
- `type`
- `isActive`
- `position`
- `transform`
- `boundingBox`
- `range`
- `property`
- `data`

## 动态图与静态图

### 静态图

- 分布在各 `ChunkObjectManager.staticGraph`
- 描述已提交对象的稳定层叠关系
- `commitObjects()` 最终会把活动对象写回这部分结构

### 动态图（AOM）

- 由 `ActiveObjectManager` 管理
- 描述创建、选择、修改等交互态对象与临时层关系
- AOM 内对象由 Worker 侧 `ViewportRenderer` 的输出层负责绘制（AOM 中存在的对象不会回退到静态缓存）

AOM 内部关键结构包括：

- `activeObjects`
- `activeObjectIndex`
- `layerOrder`
- `onLayer`
- `baseObjectSnapshotWorldRanges`
- `baseObjectSnapshotCoverChunks`

## 视口与渲染模型

### UI 侧 `Viewport`

`Viewport` 持有：

- `origin`
- `zoom`
- `width` / `height`
- DOM `canvas`
- `uiCanvas`
- `UiRenderer`

它负责屏幕坐标与世界坐标换算、workflow 挂载代理，以及把 Worker 帧绘制到页面。

### Worker 侧 `ViewportCore`

`ViewportCore` 持有：

- `origin`
- `zoom`
- `width` / `height`
- `chunkLoader`
- `renderer`
- `#frameDirty`
- `#frameId`

它负责：

- 视口区块缓冲管理
- `ViewportRenderer` 的缓存 / 输出失效与 flush
- 输出 `render-frame`，当前帧数据核心是 `liveBitmap`

## 持久化模型

当前持久化需要分“代码中的协议”与“默认运行时接线”理解。

### 已有协议

- `BoardCore` 通过 `persistenceAdapter` 暴露 `loadChunkMetadata` / `saveChunkMetadata` / `loadObjects` / `saveObjects` / `deleteObject`
- 文件桥接协议位于 `bridges/file-operate-bridge-*.js`

### 默认运行时现状

- 默认 Worker runtime 仍主要跑内存模式
- 若按当前文件桥协议落盘，主结构是：
  - `chunks/{chunkId}.json`：`{ tierGraph, objectCoverIndex }`
  - `objects/{objectId}.json`：扁平对象文件
- `createChunkStorage()` 还会创建 `chunks/{chunkId}/` 目录，但当前主读写路径不是它

### 当前不要过度假设的语义

以下内容不应再写成“已经由代码保证的稳定事实”：

- 每个对象 JSON 一定包含 `ownerChunkId`
- 对象一定按 `objects/chunk{chunkId}/{objectId}.json` 组织
- 默认 demo 已完整接通文件模式

这些更接近设计目标或局部桥接语义，而不是当前所有运行时场景下的统一现实。

## 关键术语

- **SignalPacket**：输入系统中的标准信号包，形如 `{ to, signals }`
- **LightweightObjectEntry**：UI 工具链共享的轻量对象协议
- **静态图**：区块级稳定层叠图
- **动态图 / AOM**：交互态对象与动态层关系
- **ObjectSummary**：跨线程查询返回的对象摘要
- **render hook**：BoardCore / AOM 到 ViewportCore 渲染失效的桥接协议

## 相关文档

- [core-overview.md](./core-overview.md)
- [core-runtime-boundaries.md](./core-runtime-boundaries.md)
- [file-structure.md](./file-structure.md)
- [board-document.md](../ui-thread/components/orchestration/docs/board-document.md)
- [active-object-manager-document.md](../engine/orchestration/docs/active-object-manager-document.md)
