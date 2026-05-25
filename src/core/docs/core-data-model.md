# Core 数据模型与术语统一

本文把散落在多个文档中的术语与数据结构做统一整理。

## 1. `.hwb` 的数据视角

依据 `src/core/docs/file-document.md` 与当前代码，可将 `.hwb` 理解为：

1. 白板元数据与配置（`meta.json`、`config.json`）
2. 区块组织（`chunks/connection.json` 与区块文件）
3. 对象数据（`objects/`）
4. 历史数据（`history/trash`、`history/edition`、`history/hit`）
5. 打开轨迹（`trace.json`）

主进程侧在打开/保存时使用“解压到临时目录再回写”的策略。

## 2. 内存对象模型

### 2.1 白板级

`Board` 持有：

- `chunkLoaded`: 区块 id -> `{ chunk, tempLoadedCount, fullLoadedCount, loaderStrategy }`
- `rootChunkLoader`: 白板根区块加载器
- `activeObjectManager`: 活动对象层管理
- `undoTree`: 历史树

补充说明：

- `chunks/connection.json` 中的 `count/order/size` 属于白板文件格式快照，不等同于 `Board` 的运行时字段。
- 运行时的区块实例所有权由根 `ChunkLoader` 持有；`chunkLoaded` 负责记录加载状态；连续矩形范围的区块缓冲区移动与扩缩由 `ChunkBlockLoader` 表达。

### 2.2 区块级

`Chunk` 持有：

- 四向链接：`leftChunk` / `rightChunk` / `upChunk` / `downChunk`
- `objectManager`（`ChunkObjectManager`）

`ChunkObjectManager` 持有：

- `staticGraph`: 区块内对象层叠图（有向图）
- `objectCoverChunks`: 对象覆盖区块索引

`Board` 持有：

- `objectLoaded`: 对象实例注册表，结构为 `Map<number, { obj, loadedCount }>`

其中：

- `loadedCount` 只统计对象覆盖区块上的完整加载持有数
- `loadedCount === 0` 不必然立刻删除对象；若对象仍在活动层，实例仍会保留在 `Board.objectLoaded` 中

### 2.3 对象级

`BasicObject` 的统一字段：

- `id`、`ownerChunkId`
- `position`、`transform`
- `boundingBox`、`convexHullRange`
- `getRange()` 暴露的主判定范围

典型派生：

- `StrokeObject`（可擦、无向）
- `PolygonObject`（不可擦、有向）
- `TextObject`
- `Container` 与一/二维对象层

当前对象级范围语义：

- `PolygonObject`：`localPolygonRange` / `worldPolygonRange`
- `StrokeObject`：`localPathRange` / `worldPathRange`
- `TextObject`：`localTextRange` / `worldTextRange`

这些字段代表对象的局部几何、世界几何与主判定范围，不再把普通点数组当成核心富数据结构。

## 3. 层级关系模型

按设计文档，存在两类图：

1. 静态图：稳定层叠关系
2. 动态状态图（按层拆分）：用于活动对象交互期间的临时关系

`ActiveObjectManager` 当前已经把“活动层 + 非活动子图 + 层顺序”这一模型落到代码。

## 4. 工具与设备模型

- 工具：后续消费单元，负责解释或变换设备节点送出的信号
- 设备：挂载在 Monitor 下的一棵设备子树
- 节点：设备子树中的信号处理单元，只挂 `processor`
- 控制杆：对象上的可拖拽控制点

当前实现里，设备不再被理解为单个输入对象，而是由若干节点组成的子树：

- 节点负责接收、处理、转发信号包
- 设备负责定义这棵子树包含哪些节点
- 工具负责消费设备节点继续传下来的信号

真正的输出信号属于 Core -> UI 方向。只有当信号跨越 Core-UI Interface 时，才进入事件总线或其它边界通道。

## 5. 历史模型（Undo Tree）

设计上区分：

- 原子操作（对象/区块增删改）
- 分子操作（原子组合）
- 树状历史（支持回到已撤销分支）

现状是术语和结构已定义，核心执行逻辑尚在建设阶段。

## 6. 术语对照表

- 活动对象（Active Object）: 当前被选择或被操作的对象
- 层叠图（Tier Graph）: 表示遮挡关系的有向图
- 静态图（Static Graph）: 稳定层叠关系
- 动态层（Dynamic Layers）: 活动阶段临时层关系
- 当前点（Current Node）: Undo Tree 中当前状态对应节点
- 焦点链（Focus Chain）: 从根沿后继点的主链

## 7. 开发时的认知边界

为了减少误解，建议把 Core 内容分成三类看待：

1. 已稳定基础设施
   - `DirectedGraph`
   - 几何算法与范围工具
   - 基础对象抽象
2. 已有算法但待联调
   - 活动对象分层管理
   - 区块加载器与跨区块访问策略
3. 设计先行、实现待补
   - Undo Tree 细节
   - 工具消费链完整闭环
   - 区块对象持久化全链路
