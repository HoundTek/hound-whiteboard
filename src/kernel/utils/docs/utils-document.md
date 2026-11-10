# utils 文档

本文档提供 `src/kernel/utils/` 的总览。

`src/kernel/utils/` 负责提供 Core 运行时共用的基础结构、数学能力和路径工具。这一层只提供通用能力，不直接决定白板业务规则。

## 模块分组

- 容器结构：`queue.js`
- 图与事件：`directed-graph.js`、`event-bus.js`
- 共享状态：`shared-state-store.js`
- 计数与随机：`counter-pool.js`、`random.js`、`incremental-id-pool.js`
- 哈希：`hash.js`（FNV-1a，digest stateHash 基础设施）
- 数学与几何：`math.js`、`math-algorithm.js`
- 逻辑路径：`path.js`

## 文档列表

- [counter-pool-document.md](./counter-pool-document.md)
- [directed-graph-document.md](./directed-graph-document.md)
- [event-bus-document.md](./event-bus-document.md)
- [math-document.md](./math-document.md)
- [math-algorithm-document.md](./math-algorithm-document.md)
- [path-document.md](./path-document.md)
- [queue-document.md](./queue-document.md)
- [random-document.md](./random-document.md)
- [shared-state-store-document.md](./shared-state-store-document.md)

## 目录关系

- 这一层服务于 `src/kernel/`、`src/ui/`、`src/host/` 和 `src/renderers/` 中的各模块。
- `path.js` 只处理 Core 内部逻辑路径，不处理操作系统文件路径；与文件系统或安全 IO 相关的能力在 `src/utils/` 下维护。

## 使用建议

- 若处理对象坐标、矩阵和几何变换，优先阅读 [math-document.md](./math-document.md) 与 [math-algorithm-document.md](./math-algorithm-document.md)。
- 若处理区块缓冲区、BFS 或任务排队，优先阅读 [queue-document.md](./queue-document.md)。
- 若处理层叠关系、依赖传播或拓扑判断，优先阅读 [directed-graph-document.md](./directed-graph-document.md)。
- 若处理设备图节点、输入路由或 viewport 路径，优先阅读 [path-document.md](./path-document.md)。
- 若处理运行时 id 分配，优先阅读 [counter-pool-document.md](./counter-pool-document.md)（`incremental-id-pool.js` 在其上包装来源命名空间）与 [random-document.md](./random-document.md)。

## 当前状态

- 模块分组已覆盖 `src/kernel/utils/` 下现有模块；`hash.js` 与 `incremental-id-pool.js` 暂无单模块文档。
