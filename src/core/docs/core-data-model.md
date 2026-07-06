# Core 数据模型与术语统一

本文档整理 `src/core/` 当前运行时中的核心数据模型。

## 数据权威划分

### UI 线程

UI 线程持有：

- `Board` façade
- `DevicesDAG`
- `signalsEventBus`
- `Monitor` / `MonitorProxy`
- tools / prefixs / devices
- 轻量对象条目（creator `_entry` / chooser / modifier 通用）

### Worker 线程

Worker 线程持有真正的 Core 数据权威：

- `BoardCore`
- `MonitorCore`
- `ActiveObjectManager`
- `Chunk` / `ChunkObjectManager`
- base / live 渲染结果
- `UndoTree`

### Shared 纯模型层

Worker 与 UI 共用：

- `objects/`
- `range/`
- `utils/`
- `chunk/`
- `renderer/`（除 `UiRenderer` 外）
- `shared/`

## 白板级模型

### `Board`

`Board` 是 UI façade，负责：

- 持有 `DevicesDAG` 与 `signalsEventBus`
- 管理 `monitors`
- 通过 `BoardApiRpc` 与 Worker 侧 Core 交互
- 持有本地 `CounterPool`，同步分配 objectId

### `BoardCore`

`BoardCore` 是 Core 侧真实白板状态，负责：

- `chunkLoaded`
- `objectLoaded`
- `rootChunkLoader`
- `activeObjectManager`
- `undoTree`
- `persistenceAdapter`
- `aomRenderHooks`

在 Worker mode 下，业务语义上的对象、区块与提交关系都以 Worker 中的 `BoardCore` 为准。

## objectId 模型

当前 objectId 分配规则：

1. creator 在 UI 线程通过 `Board.allocateObjectId()` 申请 id
2. `Board` 使用本地 `CounterPool` 同步递增
3. `boardApi.createObject(type, { id, ... })` 把显式 id 发往 Worker
4. Worker 侧 createObject 要求必须收到显式 id
5. 若 Worker 侧发现重复 id，会抛错并通过 `rpc-response` 返回错误

这意味着：

- UI 线程是 id 分配者
- Worker 线程是 id 使用者与校验者
- `BoardCore` 不再承担 id 分配职责

## 区块级模型

### `Chunk`

单个区块的运行时实体，包含：

- 区块坐标 / 区块 id
- `objectManager: ChunkObjectManager`
- 与邻区块的连接关系

### `ChunkObjectManager`

区块静态图管理器，包含：

- `staticGraph`：区块内静态层叠图
- `objectCoverChunks`：对象覆盖到的区块索引

### `chunkLoaded`

`BoardCore.chunkLoaded` 结构：

```js
Map<chunkId, {
  chunk,
  tempLoadedCount,
  fullLoadedCount,
  loaderStrategy,
}>
```

其语义是“这个区块当前被多少加载器以什么策略持有”，不是对象几何信息本身。

## 对象级模型

### 真实对象实例

Worker 侧真实对象实例是 `BasicObject` 及其子类：

- `StrokeObject`
- `CircleObject`
- `PolygonObject`
- 其它图形 / 容器对象

统一字段：

- `id`
- `position`
- `transform`
- `property`
- `data`
- `rich`

### UI 侧轻量对象条目（`LightweightObjectEntry`）

定义在 `shared/types.js`，UI 线程所有工具（creator / chooser / modifier）统一使用此协议。

```js
{
  id: number,                    // 对象 id
  type: string,                  // 对象类型名（如 "StrokeObject"、"CircleObject"）
  position: Vector | { x, y },   // 世界坐标位置
  boundingBox?: RectangleRange,  // 外接矩形（摘要态有，创建态无）
  range?: Range,                 // 主判定范围（摘要态有，创建态无）
  property: Record<string, any>, // 样式属性
  data: Record<string, any>,     // 类型专属几何数据
}
```

**两种场景：**

| 场景   | 代表者                  | `position` 形态                   | `boundingBox` / `range`   |
| ------ | ----------------------- | --------------------------------- | ------------------------- |
| 创建态 | creator `_entry`        | `Vector` 实例（代码直接向量运算） | 无（几何未定型）          |
| 摘要态 | chooser / modifier 条目 | `{ x, y }` 纯对象（RPC 反序列化） | 有（命中检测 / 准入判断） |

消费端（如 modifier 的 `resolveModifiedObjectPosition`）通过 `Vector.parse()` 统一处理两种 `position` 形态。

这些条目用于：

- creator 创建手势期间的本地状态
- Worker mode 下的 hitTest / queryObjects 结果
- handoff 桥接
- UI overlay

## 动态图与静态图

### 静态图

- 分布在各 `ChunkObjectManager.staticGraph`
- 表示稳定层叠关系
- `apply()` / `remove()` / `discard()` 会影响其显示结果

### 动态图（AOM）

- 由 `ActiveObjectManager` 管理
- 用于选择、创建、修改期间的临时层关系
- 对象一旦进入 AOM，应由 live 层负责绘制

AOM 内部关键结构：

- `activeObjects`
- `activeObjectIndex`
- `layerOrder`
- `onLayer`
- `baseObjectSnapshotWorldRanges`
- `baseObjectSnapshotCoverChunks`

## 视口与渲染模型

### Worker 侧

- `MonitorCore` 持有 `origin`、`zoom`、`width`、`height`
- base / live 两层通过 OffscreenCanvas 输出
- `flushRenderFrame()` 回传 `render-frame`

### UI 侧

- `MonitorProxy` 接收位图并合成到 DOM canvas
- `UiRenderer` 独立维护 overlay
- 全部 monitor 走 `MonitorProxy` 路径

## 持久化模型

持久化通过 `persistenceAdapter` 接入。

当前稳定语义：

- 对象主存储位置由 `ownerChunkId` 描述
- 覆盖区块由 `objectCoverChunks` 单独索引
- Worker / UI 运行时分层不改变 `.hwb` 的对象 / 区块语义

## 关键术语

- **运行时分层**：UI 侧通过 `BoardApiRpc` 与 Worker 侧 `BoardCore` 通信，monitor 通过 `MonitorProxy` ↔ `MonitorCore` 协作
- **轻量对象条目（LightweightObjectEntry）**：UI 侧所有工具统一使用的纯数据对象协议，替代 `BasicObject` 实例在工具间传递
- **静态图**：区块级稳定层叠图
- **动态图 / AOM**：交互态动态层关系
- **renderHooks**：AOM 到具体渲染链的注入式桥接

## 相关文档

- [core-overview.md](./core-overview.md)
- [file-structure.md](./file-structure.md)
- [board-document.md](../components/orchestration/docs/board-document.md)
- [active-object-manager-document.md](../components/orchestration/docs/active-object-manager-document.md)
- [core-runtime-boundaries.md](./core-runtime-boundaries.md)
