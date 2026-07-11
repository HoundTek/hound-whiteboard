# Core 模块详解

本文档按 `src/core/` 当前目录结构总结各模块职责与协作关系。

更细的线程边界见 [core-runtime-boundaries.md](./core-runtime-boundaries.md)。

## 顶层目录

| 目录            | 主要职责                         | 说明                                                                |
| --------------- | -------------------------------- | ------------------------------------------------------------------- |
| `bridges/`      | UI / Worker / 宿主之间的桥接协议 | 包含 RPC、持久化接口、文件 I/O bridge                               |
| `docs/`         | Core 总览与架构文档              | 当前这组顶层说明文档                                                |
| `shared/`       | UI 与 Worker 共用的纯逻辑        | 对象模型、range、共享 renderer、类型定义                            |
| `test-support/` | 测试支撑                         | canvas mock、worker-mode fixture、AOM fixture                       |
| `tests/`        | Core 级集成与 smoke tests        | Board 输入流、Worker smoke、共享模块 smoke                          |
| `ui/`           | UI 线程运行时                    | Board、Viewport、DevicesDAG、UiRenderer                             |
| `utils/`        | 通用基础设施                     | 数学、图结构、事件总线、路径、计数池                                |
| `worker/`       | Core Worker 运行时               | `core-worker.js`、BoardCore、ViewportCore、chunk、renderer、history |

## `ui/`

`ui/` 承载主线程侧的输入、视口和 overlay。

### `ui/components/orchestration/`

| 文件                    | 职责                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `board.js`              | UI 侧白板 facade，持有 `DevicesDAG`、`signalsEventBus`、`Viewport` 集合，并负责启用 Worker mode |
| `viewport.js`           | UI 侧视口 facade，负责 DOM canvas、坐标换算、Worker 同步与 workflow 挂载代理                    |
| `board-render-hooks.js` | UI 侧 render hook 工厂，适用于本地/非 Worker 场景的渲染桥接辅助                                 |

### `ui/components/renderer/`

- `ui-renderer.js`：UI overlay 渲染器
- `docs/` / `tests/`：对应文档与测试

### `ui/devices-dag/`

这是当前输入系统的主体目录，全部运行在 UI 线程。

#### 根目录

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

修饰节点和 workflow 编排工具：

- `handoff-handler.js`
- `edge-prefix.js`
- `multi-tool-handler.js`
- 其它局部状态机 / 路由辅助

#### `tools/`

叶子消费型处理器：

- `tool.js` / `gesture-tool.js`
- `creator/`：创建工具
- `chooser/`：选择工具
- `modifier/`：修改工具

### `ui/frame/`

当前目录主要承载 frame 相关文档。当前这棵 `src/core/` 代码树中没有对应的运行时 JS 实现文件，应视为文档化的概念层记录。

## `worker/`

`worker/` 是 Core Worker 的真实运行时。

### `worker/core-worker.js`

- Worker 入口
- `CoreWorkerRuntime` 消息宿主封装
- RPC / `rpc-batch` 分发
- `viewport-change` / `request-render-flush` 处理
- `render-frame` 回传

### `worker/components/orchestration/`

| 文件                       | 职责                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `board-core.js`            | Worker 侧白板权威状态，对象、区块、AOM、UndoTree、持久化协调 |
| `viewport-core.js`         | Worker 侧视口状态、区块缓冲、渲染帧输出                      |
| `active-object-manager.js` | 动态图与活动对象生命周期                                     |
| `aom-render-hooks.js`      | Worker 侧 render hook 协议与默认空实现                       |

### `worker/components/chunk/`

- `chunk.js`：区块实体
- `chunk-loader.js`：区块加载器与加载事件
- `chunk-object-manager.js`：静态图与覆盖区块索引管理

### `worker/components/renderer/`

- `viewport-renderer.js`：视口渲染器
- `dirty-rect-strategy.js`：Worker 侧脏区策略

`ViewportRenderer` 建立在 `shared/renderer/` 的 `Renderer` 基类之上，在单类内管理静态缓存与输出合成。

### `worker/hit/`

- `undo-tree-core.js`：UndoTree 骨架
- `operation.js`：操作结构定义

当前撤销/重做入口仍属 `[todo]`。

## `shared/`

`shared/` 保存可被 UI 与 Worker 同时 import 的纯逻辑模块。

### `shared/objects/`

- `basic-obj.js`：基础对象模型
- `stroke/`、`one-dim/`、`two-dim/`、`graph/`、`container.js`
- `object-deserializer.js`：对象反序列化入口

### `shared/range/`

几何范围、相交判断与转换工具：

- `rectangle.js`
- `path.js`
- `polygon.js`
- `ellipse.js`
- `rope.js`
- `intersections.js` 等

### `shared/renderer/`

共享渲染基础设施：

- `renderer.js`：渲染器基类
- `canvas-lifecycle.js`：画布生命周期辅助
- `render-scheduler.js`：脏区调度器
- `dirty-rect-strategy-shared.js`：共享脏区策略
- `ui-overlay-factory.js`：overlay 条目工厂

### `shared/types/`

跨线程共享类型定义：

- `types.js`
- `board-api-types.js`
- `message-types.js`

## `bridges/`

### `board-api.js`

- `BoardApiRpc`：UI 到 Worker 的异步 API 封装
- 高频修改使用微任务级 `rpc-batch` 合并

### `persistence-adapter.js`

- 定义 `BoardCore` 依赖的持久化适配器协议
- 提供 `createDefaultPersistenceAdapter()` 与 `createRendererPersistenceAdapter()`

### `file-operate-bridge-*.js`

- `file-operate-bridge-common.js`：动作枚举与通道定义
- `file-operate-bridge-renderer.js`：渲染线程侧调用入口
- `file-operate-bridge-main.js`：宿主/主线程侧实际文件操作

当前这些文件描述了文件模式协议，但默认 demo 仍主要运行在内存模式。

## `utils/`

`utils/` 是 Core 与应用层通用基础设施。

包含：

- `math.js` / `math3d.js`
- `math-algorithm.js`
- `directed-graph.js`
- `event-bus.js`
- `queue.js` / `deque.js`
- `path.js`
- `random.js`
- `counter-pool.js`

其中 `CounterPool` 目前由 UI 侧 `Board` 用来同步分配 `objectId`。

## `test-support/` 与 `tests/`

### `test-support/`

提供：

- Worker mode fixture
- AOM fixture
- canvas / OffscreenCanvas mock
- 测试用工具与状态辅助

### `tests/`

顶层集成测试覆盖：

- `board-input-flow.test.js`
- `core-worker-smoke.test.js`
- `monitor-ui-renderer.test.js`
- `shared-module-smoke.test.js`

## 当前状态

- 代码树已明确分成 `ui/`、`worker/`、`shared/` 三大块
- 旧的 `components/*`、`objects/*`、`range/*` 顶层路径已不再代表真实目录结构
- Worker mode 是当前主路径
- 输入系统核心都收敛在 `ui/devices-dag/`
- 完整持久化接线与撤销/重做仍属于后续完善项

## 相关文档

- [core-overview.md](./core-overview.md)
- [core-runtime-boundaries.md](./core-runtime-boundaries.md)
- [core-data-model.md](./core-data-model.md)
