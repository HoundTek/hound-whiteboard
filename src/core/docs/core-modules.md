# Core 模块详解

本文档按 `src/core/` 当前目录划分总结各模块职责与运行边界。

更细的 Worker / UI / Shared 归属见 [core-runtime-boundaries.md](./core-runtime-boundaries.md)。

## `components/`

`components/` 负责白板运行时的对象、区块、渲染与编排。

### `components/orchestration/`

| 文件                       | 运行边界 | 职责                                                                           |
| -------------------------- | -------- | ------------------------------------------------------------------------------ |
| `board-core.js`            | Worker   | 真实白板核心，持有对象、区块、AOM、UndoTree、持久化协调                        |
| `board.js`                 | UI       | UI facade，持有 DAG、signalsEventBus、viewports，通过 Worker 与 BoardCore 通信 |
| `viewport-core.js`         | Worker   | Worker 侧视口、ChunkLoader、base/live 渲染输出                                 |
| `viewport.js`              | UI       | UI 侧 viewport，接收 Worker 侧回传的 `render-frame`                            |
| `active-object-manager.js` | Shared   | 动态层关系、活动对象生命周期与静态图回写                                       |
| `aom-render-hooks.js`      | Shared   | AOM 渲染钩子接口                                                               |
| `board-render-hooks.js`    | UI       | AOM 渲染请求到 viewport 渲染器的桥接层                                         |

### `worker/components/chunk/`

- `chunk.js`：区块实体
- `chunk-loader.js`：加载器与引用计数
- `chunk-object-manager.js`：区块静态图与对象覆盖区块索引

这一层属于 Worker。

### `components/renderer/`

| 文件                      | 运行边界 | 职责         |
| ------------------------- | -------- | ------------ |
| `renderer.js`             | Shared   | 渲染器基类   |
| `base-renderer.js`        | Shared   | base 层渲染  |
| `live-renderer.js`        | Shared   | live 层渲染  |
| `ui-renderer.js`          | UI       | overlay 渲染 |
| `render-scheduler.js`     | Shared   | 脏区调度     |
| `dirty-rect-strategy*.js` | Shared   | 脏区策略     |

## `bridges/`

- `board-api.js`
  - `BoardApiRpc`：UI 线程 RPC 客户端，通过 postMessage 与 Worker 侧 BoardCore 通信。高频写入（modifyObject / appendListItem / replaceListItem / removeListItem）使用微任务级批处理，同 id 自动合并为单次 `rpc-batch` 消息
- `persistence-adapter.js`：持久化接口与默认内存适配
- `file-operate-bridge-*`：宿主文件 I/O 桥接，运行在 UI / preload 相关边界

## `devices-dag/`

设备图、节点状态和信号路由系统，全部运行在 UI 线程。

当前 `devices-dag/` 下包含全部输入编排模块：

### 核心 DAG（`devices-dag/` 根目录）

- `dag.js`、`dag-builder.js`、`dag-node-edge.js`、`dag-utils.js`
- `signal.js`：SignalPacket 定义
- `index.js`：公开接口

### `devices/`（输入设备定义）

- `mouse-device.js`、`keyboard-device.js`、`touchscreen-device.js`
- 把宿主输入编码成稳定的 `SignalPacket`，再交给 DAG 分发

### `tools/`（交互工具）

所有工具都在 UI 线程执行。

#### `tools/creator/`

- 使用 `_entry` 纯数据状态（`LightweightObjectEntry` 协议）维护手势期对象几何
- 通过 `BoardApiRpc` fire-and-forget 同步 Worker 侧真实对象（高频写入经微任务批处理合并）
- 当前 demo 已接通 `StrokeCreatorTool`、`CircleCreatorTool`、`PolygonCreatorTool`

#### `tools/chooser/`

- `ObjectChooserTool`：选择工具基类
- `RectangleObjectChooserTool`：矩形框选实现
- Worker mode 下读路径通过 `hitTest + queryObjects` 异步完成

#### `tools/modifier/`

- `ObjectModifierTool`：修改工具基础设施
- `GestureBasedObjectModifierTool`：position / displacement 双通道手势调度
- `CommonObjectModifierTool`：通用位置修改实现

### `prefixes/`（输入编排）

- `handoff-handler.js`：creator / chooser → modifier 两阶段工作流
- `edge-prefix.js`、`prefix-node.js` 等：信号转换、注入和局部状态机

## `objects/`

对象模型层，属于 Shared。

- `basic-obj.js`：基础对象抽象
- `stroke/`：笔画对象
- `graph/`：Circle / Polygon 等几何对象
- `object-deserializer.js`：反序列化入口

对象在 Worker 与 UI 两边都可能被使用：

- Worker 侧用于真实状态、渲染与命中
- UI 侧用于测试与局部纯数据 helper

## `range/`

几何范围抽象层，属于 Shared。

- `RectangleRange`
- `PathRange`
- `PolygonRange`
- `EllipseRange`
- `RopeRange`

chooser、modifier、renderer 与 chunk 覆盖计算都会依赖它。

## `utils/`

纯工具层，属于 Shared。

包含：

- `math.js` / `math3d.js`
- `math-algorithm.js`
- `directed-graph.js`
- `event-bus.js`
- `queue.js` / `deque.js`
- `random.js`
- `counter-pool.js`

当前 `CounterPool` 由 UI 侧 `Board` 自持，用于同步分配 objectId。

## `hit/`

历史结构层，属于 Worker。

- `undo-tree-core.js` 已作为运行时骨架接入 `BoardCore`
- 更完整的 operation 语义与历史回放仍属于后续完善项

## `shared/`

跨线程共享类型定义，属于 Shared。

- `types.js`
- `board-api-types.js`
- `message-types.js`

这些文件只提供 JSDoc typedef 与协议约定，不承载业务逻辑。

## `test-support/`

测试支撑模块，提供 canvas / OffscreenCanvas / ImageBitmap mock 等 helper。

## 当前状态

- Core Worker 架构已落地：BoardCore / ViewportCore / BoardApiRpc / Viewport 全部接通
- tools 保持在 UI 线程
- objects / range / utils / renderer / AOM 作为共享层复用；chunk 在 Worker 侧运行
- 主要剩余项集中在性能优化与基准测试

## 相关文档

- [core-overview.md](./core-overview.md)
- [core-data-model.md](./core-data-model.md)

- [core-runtime-boundaries.md](./core-runtime-boundaries.md)
