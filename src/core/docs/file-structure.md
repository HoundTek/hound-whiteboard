# `.hwb` 文件结构文档

本文档整理当前代码中**可以被源码直接验证**的 `.hwb` 文件结构与持久化语义。

需要特别说明：

- 这份文档描述的是当前 file bridge 协议与 `BoardCore` 持久化接口所约定的结构
- 默认 Worker runtime 仍主要运行在内存模式
- 因此这里的目录结构应理解为“当前文件模式合同”，而不是“所有运行场景默认都会落盘的结果”

## 概述

当前持久化相关代码分成两层：

1. `BoardCore.persistenceAdapter`：Core 侧的持久化接口
2. `bridges/file-operate-bridge-*.js`：宿主侧真实文件读写实现

如果只执行 `createBoardRoot()`，当前确定会创建的是：

```text
.hwb/
  meta.json
  config.json
  devices/
  history/
  objects/
  chunks/
  templates/
```

在后续文件模式操作中，当前 bridge 还会继续读写这些路径：

```text
.hwb/
  trace.json               # 可选，缺失时可按 connection 推导默认值
  chunks/
    connection.json
    {chunkId}.json
    {chunkId}/             # 当前由 createChunkStorage 创建，但不是主读写路径
  objects/
    {objectId}.json
```

## 当前稳定语义

### 1. 区块元数据按单文件保存

每个区块当前的主元数据文件是：

```text
chunks/{chunkId}.json
```

其内容形如：

```json
{
  "tierGraph": [],
  "objectCoverIndex": []
}
```

字段含义：

- `tierGraph`：区块静态层叠图的数组化结果
- `objectCoverIndex`：对象覆盖区块索引，格式通常为 `Array<[objectId, number[]]>`

当前代码不会再把覆盖索引单独写成 `{chunkId}-object-cover.json`。

### 2. 对象当前是扁平存储

对象文件当前主路径是：

```text
objects/{objectId}.json
```

而不是旧文档中的：

```text
objects/chunk{chunkId}/{objectId}.json
```

当前 bridge 的 `loadObjects` / `saveObjects` / `deleteObject` 都按这个扁平结构工作。

### 3. `chunks/{chunkId}/` 目录目前不是主数据路径

`createChunkStorage()` 仍会创建：

```text
chunks/{chunkId}/
```

但当前主读写逻辑：

- 区块元数据读写走 `chunks/{chunkId}.json`
- 对象读写走 `objects/{objectId}.json`

因此 `chunks/{chunkId}/` 更适合视为历史遗留或预留扩展目录，而不是当前主要持久化载体。

## 各文件与目录说明

### `meta.json`

白板元信息文件。

当前 file bridge 在创建根目录时会先写入它；读取白板快照时也会先校验它是否存在以及类型是否匹配。

### `config.json`

白板配置文件。

它与 `meta.json` 一起在 `createBoardRoot()` 时被创建；但若要让 `loadBoardSnapshot()` 成功，当前还需要 `chunks/connection.json` 作为必需元数据的一部分。

### `trace.json`

记录最近一次打开/浏览位置的轨迹信息。

当前结构至少涉及：

- `onChunk`
- `offset`

若文件不存在，bridge 会根据 `connection.json` 推导默认值。

### `chunks/connection.json`

记录区块连接与顺序信息。当前读取白板快照时会把它当作必需文件。

典型字段包括：

- `count`
- `order`
- `size`

### `chunks/{chunkId}.json`

单区块元数据文件，包含：

- `tierGraph`
- `objectCoverIndex`

### `objects/{objectId}.json`

对象序列化结果。

当前应该注意两点：

1. 路径是按 `objectId` 扁平组织
2. 不应在顶层文档中再把 `ownerChunkId` 写成“当前代码保证存在”的稳定字段

是否带有 `ownerChunkId` 取决于具体对象类型或未来扩展，基础 `BasicObject.serialize()` 并不默认产出这个字段。

### `devices/` / `templates/` / `history/`

这些目录在 `createBoardRoot()` 中会被创建，但当前顶层 Core 文档里不应过度推断它们的完整业务语义：

- `devices/`：可视为宿主或白板扩展数据预留区
- `templates/`：模板相关数据预留区
- `history/`：历史与版本空间，当前仍应视为 `[todo]` 能力

## 与运行时模型的关系

### `BoardCore`

`BoardCore` 通过 `persistenceAdapter` 表达对持久化的需求：

- `loadChunkMetadata`
- `saveChunkMetadata`
- `loadObjects`
- `saveObjects`
- `deleteObject`

### file bridge

宿主侧 file bridge 负责把这些抽象操作映射到 `.hwb` 目录结构。

也就是说，当前这份目录结构更准确地说是：

- **bridge 层的主存储合同**
- 与 `BoardCore` 的持久化接口相匹配

### 默认运行时现状

当前默认 Worker runtime 创建 `BoardCore` 时仍使用 `createDefaultPersistenceAdapter()`。

因此：

- 内存模式是当前最常见路径
- 完整文件模式属于已定义协议但未全面成为默认运行时的能力

## 当前已知约束

- `undo` / `redo` 与 `history/` 的真实落盘语义尚未实现
- 顶层文档不应再把对象按 ownerChunk 分目录存储写成现状
- 顶层文档不应再把 cover index 单独文件写成现状
- `objectId` 计数池恢复尚未从文件层接回 UI 侧 `CounterPool`

## 相关文档

- [core-data-model.md](./core-data-model.md)
- [core-overview.md](./core-overview.md)
- [board-core-document.md](../engine/orchestration/docs/board-core-document.md)
- [file-operate-document.md](../bridges/docs/file-operate-document.md)
