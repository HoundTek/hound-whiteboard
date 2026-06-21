# Core 模块详解（含实现状态）

本文按模块总结“职责、关键类、现状”。

## 1. components/

components 模块已按职责拆分为三个子目录，外部通过 `index.js` 统一导入。

```
src/core/components/
├── chunk/          # 区块子系统（Chunk / ChunkLoader / ChunkLoader / ChunkObjectManager）
├── renderer/       # 渲染管线（BaseRenderer / LiveRenderer / UiRenderer / RenderScheduler / DirtyRectStrategy）
├── orchestration/  # 编排层（Board / Monitor / ActiveObjectManager）
├── index.js        # 统一导出入口
├── docs/
└── tests/
```

### 1.1 编排层（`orchestration/`）

#### Board

目标职责：

- 管理白板级状态（宽高、根目录、块实例所有权与加载状态）
- 管理块加载与对象写入
- 管理 `UndoTree` 与 `ActiveObjectManager`

当前状态：

- 字段与主要流程框架已在 `src/core/components/orchestration/board.js` 建立。
- 运行时区块状态已统一到 `chunkLoaded`。
- 仍有明显 `todo`：创建文件结构、完整区块加载、历史状态回放、设备相关联动。

#### ActiveObjectManager

目标职责：

- 管理当前活动对象
- 以层结构维护活动对象与非活动对象子图
- 支持选择、取消选择、置顶、整理层

当前状态：

- 是 Core 中实现最完整的复杂模块之一。
- 已包含：
  - 子图拾取（含跨区块访问）
  - 选择分层逻辑（按路径活动点数分层）
  - 层插入、层顺序比较、置顶与清理
- 仍有待打磨：区块加载器与真实文件路径联动、性能优化、边界处理测试补全。

### 1.2 区块子系统（`chunk/`）

#### Chunk

目标职责：

- 管理单区块对象
- 维护四向区块链
- 提供完整加载/临时加载/卸载

当前状态：

- 基本字段和区块连接逻辑已存在。
- 临时加载 (`loadTemp`) 可加载层叠图。
- 完整对象加载、落盘、卸载清理仍待完成。

#### ChunkObjectManager

目标职责：

- 管理区块级静态对象图（层叠关系）
- 管理对象覆盖区块索引，并通过 Board 间接解析对象实例

当前状态：

- `staticGraph` 与 `objectCoverChunks` 数据结构已定义，对象实例所有权已上移到 `Board.objectLoaded`。
- `loadTierGraph()` 能解析图结构。
- 对象读写已改为经 `Board` 统一调度，图落盘与覆盖索引落盘已接通。

#### ChunkLoader / ChunkLoader

目标职责：

- `ChunkLoader`：通用区块加载器，是区块对象的持有者，负责按 id/坐标访问与卸载区块。
- `ChunkLoader`：`ChunkLoader` 的包装器，负责连续矩形范围的区块缓冲区与当前区块位置管理。

当前状态：

- 基础缓存和引用计数已就绪。
- 与 `Board` 的完整加载联动仍在进行中。

### 1.3 渲染管线（`renderer/`）

包含 `BaseRenderer`、`LiveRenderer`、`UiRenderer`、`RenderScheduler`、`DirtyRectStrategy`，负责脏区域计算、多层画布渲染调度与 UI 覆盖层渲染。

当前状态：

- `BaseRenderer` 已支持静态层整层重绘和 dirty rect 局部刷新。
- `LiveRenderer` 已支持活动层整层重绘和 dirty rect 局部刷新。
- `RenderScheduler` 已支持多次 invalidate 合并到单帧 flush。
- `UiRenderer` 已提供兼容 overlay 渲染和 provider 扩展口。
- 仍在向区块级补绘推进。

## 2. objects/

### 2.1 基础层次

对象继承链主干：

- `BasicObject`
- `Container`
- `OneDimensionObject` / `TwoDimensionObject`
- 具体对象（如 `TextObject`、`PolygonObject`、`StrokeObject`）

`BasicObject` 已定义关键通用能力：

- 位置、变换矩阵
- 包围盒、凸包范围与主判定范围
- 点命中判断
- 序列化/渲染抽象接口

### 2.2 代表对象

- `PolygonObject`
  - 已实现局部/世界多边形范围管理、凸包范围/包围盒更新、命中判断、渲染，以及 `setPolygonPoints()`、`replacePolygonPoint()`、`appendPolygonPoint()` 等对象语义接口。
- `StrokeObject`
  - 已实现局部/世界路径范围管理、平滑插点、凸包范围与包围盒更新、渲染，以及 `setPathPoints()` 等路径语义接口。
- `TextObject`
  - 已有基础文本属性、四点文本范围与渲染；自动分行逻辑仍是占位实现。

## 3. tools/

### 3.1 设计定位

工具是设备节点之后的消费单元。它接收整包信号，并对这些信号执行创建、修改、选择、擦除或白板操作等逻辑。

### 3.2 当前代码状态

- 基类 `Tool`、创建工具基类 `ObjectCreatorTool` 已具备。
- 已有可用子类：
  - `StrokeCreatorTool`
  - `PolygonCreatorTool`
- 仍未完整：
  - chooser/eraser/board 工具大多为空或仅占位
  - 多个工具文档为空，尚未与实现同速更新
  - 其它工具族仍在裁剪与补线中

当前已接通的一条核心纵向链路是：

- 设备输入进入 `SignalPacket`
- `Board.signalsEventBus` 分发到目标 `Monitor`
- `DevicesDAG` 路由到末端 workflow 节点
- creator 工具默认从 `Board` 申请 `objectId`
- creator 工具直接消费输入包中的世界坐标，并默认从 `Monitor` 解析 `ownerChunkId`
- 新对象先进入 `ActiveObjectManager.add()`，完成后再通过 `apply()` 回写白板

## 4. hit/

### 4.1 设计目标

`operation-document.md` 与 `undo-tree-document.md` 规划了：

- 原子操作 / 分子操作
- 支持分支撤销的 Undo Tree
- attempt 与 vip 等扩展概念

### 4.2 当前状态

- `operation.js` 与 `undo-tree-core.js` 仅有类骨架。
- 实际历史操作记录、回放、压缩与落盘逻辑尚未实现。

## 5. devices/

- `DevicesDAG` 负责保存节点与边的结构，并按路径把信号包送到节点 handler。
- `DevicesDAGNode` 只表示信号处理单元，核心字段是 `handler`、`defaultRoute`、`umount` 与 `state`。
- 结构化输入子图已经统一为 `rootPath + nodes + edges` 结构，推荐通过 `createSubDAG(rootPath).build()` 生成。
- 业务侧挂载设备时应优先从 `Monitor` 的 `mountSubDAG()` 进入，再由 `Monitor` 代理到 `Board` 持有的唯一 `DevicesDAG`。
- 输入从 Board 到 Monitor、再到 DevicesDAG 与 workflow 节点的完整链路，见 `core-input-flow.md`。
- DOM/Pointer/Touch 到 `SignalPacket` 的编码约定，见 `core-input-encoding.md`。
- 当前建议冻结的阶段性稳定接口，见 `core-stable-interfaces.md`。

当前状态：

- 节点级 `processor` 路由模型已经建立。
- 设备子图定义可展开并挂载到设备图。
- Core 内部信号通过节点处理器递归传递；处理器可来自闭包、工厂函数或对象方法。
- 跨 Core-UI Interface 的信号边界已经在文档层明确。

## 6. utils/ 与 range/

### 6.1 DirectedGraph

`DirectedGraph` 是当前 Core 最稳定的底层模块之一，包含：

- 节点/边增删改查
- 入度出度与零入度/零出度查询
- DAG 判定
- 序列化与反序列化
- 图等价比较

### 6.2 几何算法

`math-algorithm.js` 包含：

- 凸包计算（Graham 扫描）
- 曲线插点（用于笔画平滑）
- 绳钉求交（点在多边形内判断）

### 6.3 其他

- `CounterPool`：对象 id 递增池
- `RectangleRange`：矩形范围抽象，以及 range 子系统中的统一包围盒表示
