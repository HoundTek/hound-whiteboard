# `.hwb` 文件结构文档

本文档整理 `.hwb` 白板文件当前的持久化语义。

## 概述

`.hwb` 是白板数据的归档格式。当前实现通过宿主层把白板内容展开到目录结构，再由 `persistenceAdapter` / file bridge 读写对象与区块元数据。

Worker / UI 的运行时拆分不会改变 `.hwb` 的核心语义：

- 区块仍按区块 id 与区块文件组织
- 对象仍按 objectId 与 `ownerChunkId` 组织
- 对象覆盖到的其它区块仍通过独立索引描述

## 当前稳定语义

### 对象归属区块

每个对象都有一个主存储位置：`ownerChunkId`。

- 对象本体存放在归属区块对应的数据分组中
- 对象几何若跨越多个区块，额外覆盖到的区块不复制对象本体
- 这些覆盖关系通过区块级 `objectCoverChunks` 索引描述

### 区块静态图

每个区块都可以拥有一份静态层叠图快照：

- 节点是 objectId
- 边表示上下遮挡关系
- 文件只描述图结构，不直接内嵌对象实例内容

### 覆盖区块索引

对象覆盖到哪些区块，由区块级独立索引维护：

```json
[
  [15, [1, 2]],
  [18, [1, 2, 3]]
]
```

其含义是：

- 对象 `15` 覆盖区块 `1` 与 `2`
- 对象 `18` 覆盖区块 `1`、`2` 与 `3`

### 历史结构

历史数据目录（如 `history/`）在设计上保留给：

- 删除对象 / 区块的暂存
- 历史版本
- Undo Tree 相关数据

这部分语义仍处于后续完善阶段，应视为 `[todo]`。

## 目录示意

以下结构描述的是语义边界，不代表当前运行时一定逐项完整落地：

```text
.hwb/
  chunks/
    connection.json
    {chunkId}.json
    {chunkId}-object-cover.json
  objects/
    chunk{chunkId}/
      {objectId}.json
  history/                # [todo] 历史与版本结构
  templates/              # 模板 / 宿主扩展数据
  config.json
  meta.json
```

## 各目录说明

### `chunks/`

#### `connection.json`

区块连接与白板范围相关元数据。

当前实现中，这里的字段主要用于：

- 描述区块集合的顺序或范围
- 作为持久化层的目录级元数据快照

其中与运行时计数池相关的字段应视为持久化层历史遗留语义；当前 UI 线程的 objectId 分配由 `Board` 自持 `CounterPool` 负责，尚未从文件恢复计数状态。

#### `{chunkId}.json`

区块静态层叠图。

#### `{chunkId}-object-cover.json`

区块对象覆盖索引。

### `objects/`

对象实例内容。

当前稳定语义：

- 文件名通常是 objectId
- 对象 JSON 内部带有 `ownerChunkId`
- 对象实际覆盖范围仍需要结合区块级 `objectCoverChunks` 索引判断

### `history/`

历史结构目录。

- 删除对象 / 区块暂存
- 历史版本
- Undo Tree 块

当前应视为 `[todo]` 语义区。

### `config.json` / `meta.json`

白板配置与元数据。

## 与运行时模型的关系

### UI 线程

UI 线程：

- 分配 objectId
- 维护输入图与工具状态
- 通过 `BoardApiRpc` 请求 Worker 读写持久化相关对象语义

### Worker 线程

Worker 线程：

- 持有真实 `BoardCore`
- 维护对象注册表、区块静态图与覆盖索引
- 决定对象提交 / 删除 / 命中查询的真实结果

因此 `.hwb` 文件的对象与区块语义，最终仍以 Worker 侧 `BoardCore` 的读写结果为准。

## 设计约束

- `.hwb` 文件结构的稳定语义是“对象本体 + 区块静态图 + 覆盖区块索引”三件事
- Worker / UI 分层不应改变持久化格式本身
- 历史结构与计数池恢复仍属于后续完善项

## 相关文档

- [core-data-model.md](./core-data-model.md)
- [board-document.md](../components/orchestration/docs/board-document.md)
- [chunk-object-manager-document.md](../components/chunk/docs/chunk-object-manager-document.md)
