# Core 模块详解

本文档按 `src/core/engine/` + `src/core/ui-thread/` + `src/core/bridges/` 当前目录结构总结各模块职责与协作关系。

更细的线程边界见 [core-runtime-boundaries.md](./core-runtime-boundaries.md)。

## 顶层目录

| 目录            | 主要职责                         | 说明                                                                |
| --------------- | -------------------------------- | ------------------------------------------------------------------- |
| `engine/`       | 核心领域层                       | 对象模型、range、渲染基类、BoardCore、ViewportCore、chunk、AOM      |
| `ui-thread/`    | UI 线程运行时                    | Board、Viewport、DevicesDAG、UiRenderer                             |
| `bridges/`      | UI / Worker / 宿主之间的桥接协议 | 包含 RPC、持久化接口、文件 I/O bridge                               |
| `test-support/` | 测试支撑                         | canvas mock、worker-mode fixture、AOM fixture                       |
| `tests/`        | 跨模块冒烟测试                   | Board 输入流、Worker smoke、共享模块 smoke                          |
| `docs/`         | 架构总览文档                     | 当前这组顶层说明文档                                                |

## `ui-thread/`

`ui-thread/` 承载主线程侧的输入、视口和 overlay。

### `ui-thread/components/orchestration/`

| 文件                    | 职责                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `board.js`              | UI 侧白板 facade，持有 `DevicesDAG`、`signalsEventBus`、`Viewport` 集合，并负责启用 Worker mode |
| `viewport.js`           | UI 侧视口 facade，负责 DOM canvas、坐标换算、Worker 同步与 workflow 挂载代理                    |
| `board-render-hooks.js` | UI 侧 render hook 工厂，适用于本地/非 Worker 场景的渲染桥接辅助                                 |

### `ui-thread/components/renderer/`

- `ui-renderer.js`：UI overlay 渲染器
- `ui-overlay-factory.js`：UI overlay 条目工厂

### `ui-thread/devices-dag/`

这是当前输入系统的主体目录，全部运行在 UI 线程。

#### 根目录

- `dag-type.js`：公共类型定义（typedef 与核心类别名）
- `index.js`：统一 re-export 入口

#### `dag-core/`（引擎）

- `dag.js`：`DevicesDAG` 核心实现
- `dag-builder.js`：`createSubDAG()` DSL
- `dag-node-edge.js`：节点与边定义
- `dag-utils.js`：handler result 规整、类型判断
- `signal.js`：`SignalPacket` 抽象
- `dag-debug.js`：DAG 调试输出

#### `devices/`

设备被建模为 `SubDAGDefinition`：

- `mouse-device.js`
- `keyboard-device.js`
- `touchscreen-device.js`

设备负责把宿主输入转换为稳定设备信号，不直接修改白板对象。

#### `prefixes/`

修饰节点（边级转换、信号观测、复制分发等局部编排）：

- `handler.js` / `repeater-handler.js` / `signal-log-handler.js`
- `edge-prefix.js` / `canvas-to-world-handler.js`

#### `tools/`

叶子消费型处理器：

- `tool.js` / `gesture-tool.js`
- `creator/`：创建工具
- `chooser/`：选择工具
- `modifier/`：修改工具
- `wrapper/`：复合工具（顺序 / 互斥组合，如 handoff、tool-switcher）

## `engine/`

`engine/` 是 Core 的核心领域层，可在 Worker、CLI、TUI 等任何运行时中使用。

### `engine/core-worker.js`

- Worker 入口
- `CoreWorkerRuntime` 消息宿主封装
- RPC / `rpc-batch` 分发
- `viewport-change` / `request-render-flush` 处理
- `render-frame` 回传

### `engine/orchestration/`

| 文件                       | 职责                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `board-core.js`            | Worker 侧白板权威状态，对象、区块、AOM、UndoTree、持久化协调 |
| `viewport-core.js`         | Worker 侧视口状态、区块缓冲、渲染帧输出                      |
| `active-object-manager.js` | 动态图与活动对象生命周期                                     |
| `aom-render-hooks.js`      | Worker 侧 render hook 协议与默认空实现                       |

### `engine/chunk/`

- `chunk.js`：区块实体
- `chunk-loader.js`：区块加载器与加载事件
- `chunk-object-manager.js`：静态图与覆盖区块索引管理

### `engine/renderer/`

- `renderer.js`：`BaseRenderer` 基类
- `canvas-lifecycle.js`：Canvas 生命周期管理
- `render-scheduler.js`：渲染调度器
- `dirty-rect-strategy.js` / `dirty-rect-strategy-shared.js`：脏区策略
- `viewport-renderer.js`：Worker 侧视口渲染器
- `aom-collect-utils.js`：AOM 渲染收集辅助

`ViewportRenderer` 建立在 `engine/renderer/` 的 `BaseRenderer` 基类之上，在单类内管理静态缓存与输出合成。

### `engine/hit/`

- `undo-tree-core.js`：UndoTree 骨架
- `operation.js`：操作结构定义

当前撤销/重做入口仍属 `[todo]`。

### `engine/objects/`

- `basic-obj.js`：基础对象模型
- `stroke/`、`one-dim/`、`two-dim/`、`graph/`、`container.js`
- `object-deserializer.js`

### `engine/range/`

- `range.js`、`rectangle.js`、`ellipse.js`、`polygon.js`、`path.js`、`rope.js`
- `bounds.js`、`geometry.js`、`intersections.js`、`conversion.js`、`segment-math.js`

### `engine/types/`

- `types.js`（含 `ViewportLike` 等共享 typedef）
- `board-api-types.js`
- `message-types.js`

### `engine/utils/`

- `math.js`、`math3d.js`、`math-algorithm.js`
- `directed-graph.js`、`path.js`、`chain.js`
- `event-bus.js`、`deque.js`、`queue.js`
- `counter-pool.js`、`random.js`
