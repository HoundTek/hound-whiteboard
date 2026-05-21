# directed-graph 文档

本文档提供 `src/core/utils/directed-graph.js` 的概述。

## 模块职责

`directed-graph.js` 提供一个通用有向图实现 `DirectedGraph`，以及一组图结构错误类型。

它在仓库中的主要职责是表达对象层叠关系、依赖关系和前驱后继关系。该模块只负责图结构维护，不负责业务层的排序决策。

## 导出内容

- `DirectedGraph`：有向图本体
- `GraphError`：图错误基类
- `NodeNotExistError`：节点不存在
- `EdgeNotExistError`：边不存在
- `NodeAlreadyExistError`：节点已存在
- `EdgeAlreadyExistError`：边已存在

## 数据结构

`DirectedGraph` 同时维护正向和反向邻接表：

| 名称 | 描述 | 类型 |
|---|---|---|
| `adjList` | 正向邻接表，记录节点的后继 | `Map<*, Set<*>>` |
| `adjListR` | 反向邻接表，记录节点的前驱 | `Map<*, Set<*>>` |

这种双表结构让“查后继”和“查前驱”都保持直接访问，也让入度和出度统计不需要重新遍历整张图。

## 核心 API

### 节点与边维护

| 名称 | 描述 |
|---|---|
| `hasNode(node)` | 判断节点是否存在 |
| `hasEdge(from, to)` | 判断边是否存在 |
| `addNodeUnsafe(node)` / `addNode(node)` | 添加节点 |
| `addEdgeUnsafe(from, to)` / `addEdge(from, to)` | 添加边 |
| `deleteEdgeUnsafe(from, to)` / `deleteEdge(from, to)` | 删除边 |
| `changeNodeNameUnsafe(oldNode, newNode)` / `changeNodeName(oldNode, newNode)` | 重命名节点 |
| `deleteAllEdgesOfNodeUnsafe(node)` / `deleteAllEdgesOfNode(node)` | 清空节点关联边 |
| `deleteNodeUnsafe(node)` / `deleteNode(node)` | 删除节点及其关联边 |

### 查询能力

| 名称 | 描述 |
|---|---|
| `neighborsUnsafe(node)` / `neighbors(node)` | 查询后继节点集合 |
| `predecessorsUnsafe(node)` / `predecessors(node)` | 查询前驱节点集合 |
| `getInDegreeUnsafe(node)` / `getInDegree(node)` | 查询入度 |
| `getOutDegreeUnsafe(node)` / `getOutDegree(node)` | 查询出度 |
| `getInDegreeMap()` | 获取所有节点入度映射 |
| `getOutDegreeMap()` | 获取所有节点出度映射 |
| `getNoIncomingNodes()` | 获取所有入度为 0 的节点 |
| `getNoOutgoingNodes()` | 获取所有出度为 0 的节点 |
| `getNodes()` | 获取全部节点 |
| `size` | 当前节点数量 |
| `isEmpty()` | 判断图是否为空 |
| `isDAG()` | 判断图是否为 DAG |

### 序列化与比较

| 名称 | 描述 |
|---|---|
| `clear()` | 清空图 |
| `toArray()` | 导出为邻接表数组 |
| `toString()` | 导出调试字符串 |
| `equals(otherGraph)` | 比较两张图是否结构相等 |
| `DirectedGraph.parse(arr)` | 从邻接表数组构造实例 |

## 设计约束

- 带 `Unsafe` 后缀的方法默认假定参数已合法，不做存在性校验。
- 非 `Unsafe` 方法会在节点或边状态不满足前置条件时抛出对应错误。
- `changeNodeNameUnsafe()` 会同步更新前驱表和后继表，保持双向邻接表一致。
- `isDAG()` 使用 Kahn 算法做环检测，适合当前仓库规模。

## 在仓库中的典型用途

- 在活动对象管理器里表达对象层叠与依赖顺序
- 在区块对象管理中维护静态图结构
- 为后续拓扑判断、分层传播和冲突检测提供基础容器

## 相关文档

- [utils-document.md](./utils-document.md)
- [queue-document.md](./queue-document.md)
- [event-bus-document.md](./event-bus-document.md)