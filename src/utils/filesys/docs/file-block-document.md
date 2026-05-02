# file-block 文档

本文档提供 `src/utils/filesys/file-block.js` 的概述。

## 模块职责

`file-block.js` 提供面向“块文件”的存储封装，核心目标是将多个逻辑文件聚合到 8KB~16KB 的块中，降低大量小文件带来的管理成本，同时保留按文件 ID 的读写能力。可行性验证在 [io-file-granularity.md](./io-file-granularity.md)。

模块主要包含：

- `FileBlock`：单个块文件封装
- `UnorderedBlockAllocator`：无序块分配器

## FileBlock

`FileBlock` 用于表示一个块文件，并提供块内条目的增删改查、分割与合并。

### 核心字段

| 名称 | 描述 | 类型 |
|---|---|---|
| `blockFile` | 对应的块文件对象 | `File` |
| `entries` | 块内条目映射（`fileId -> entry`） | `Map<string, entry>` |

### 常用方法

| 名称 | 描述 | 类型 |
|---|---|---|
| `load()` | 从磁盘加载块内容 | `void -> FileBlock` |
| `flush()` | 将内存状态写回磁盘 | `void -> FileBlock` |
| `listFiles()` | 获取块内全部条目 | `void -> entry[]` |
| `hasFile(fileId)` | 判断条目是否存在 | `string -> boolean` |
| `getFile(fileId)` | 获取指定条目 | `string -> entry\|null` |
| `addFile(fileId, payload, options)` | 新增条目 | `string -> (string\|Object) -> Object -> FileBlock` |
| `addFromSourceFile(sourceFile, options)` | 从外部文件导入条目 | `File -> Object -> FileBlock` |
| `updateFile(fileId, payload)` | 更新条目内容 | `string -> (string\|Object) -> FileBlock` |
| `removeFile(fileId)` | 删除条目 | `string -> boolean` |
| `byteSize()` | 计算当前块字节大小 | `void -> number` |
| `split(targetBlock, filter)` | 将部分条目移动到目标块 | `FileBlock -> Function -> splitResult` |
| `merge(sourceBlock, options)` | 合并来源块条目 | `FileBlock -> Object -> FileBlock` |

## UnorderedBlockAllocator

`UnorderedBlockAllocator` 绑定一个目录，统一管理目录下所有块文件，并维护 `fileId -> blockId` 索引。

### 核心字段

| 名称 | 描述 | 类型 |
|---|---|---|
| `blockDir` | 块目录 | `Directory` |
| `minBlockSize` | 块最小目标大小 | `number` |
| `maxBlockSize` | 块最大目标大小 | `number` |
| `blockPrefix` | 块文件名前缀 | `string` |
| `blockExtension` | 块文件扩展名 | `string` |
| `autoFlush` | 操作后是否自动持久化 | `boolean` |
| `blocks` | 已加载块映射（`blockId -> FileBlock`） | `Map<string, FileBlock>` |
| `fileToBlock` | 逻辑文件到块 ID 索引 | `Map<string, string>` |

### 常用方法

| 名称 | 描述 | 类型 |
|---|---|---|
| `load()` | 扫描目录并重建索引 | `void -> UnorderedBlockAllocator` |
| `listBlocks()` | 查看块统计信息 | `void -> blockInfo[]` |
| `listBlocksByRemainingSpace(order)` | 按剩余空间排序块 | `string -> blockInfo[]` |
| `locateFile(fileId)` | 定位文件所在块 | `string -> locateResult\|null` |
| `getFile(fileId)` | 读取逻辑文件 | `string -> entry\|null` |
| `estimateEntrySizeHint(fileId, payload)` | 估算写入大小提示 | `string -> (string\|Object) -> number` |
| `allocateForWrite(sizeHint)` | 按 sizeHint 分配写入块 | `number -> allocation` |
| `addFile(fileId, payload)` | 写入新逻辑文件 | `string -> (string\|Object) -> addResult` |
| `updateFile(fileId, payload)` | 更新逻辑文件 | `string -> (string\|Object) -> entry` |
| `removeFile(fileId)` | 删除逻辑文件 | `string -> boolean` |
| `splitBlock(blockId)` | 分裂指定块 | `string -> splitResult` |
| `mergeBlocks(targetId, sourceId, options)` | 合并两个块 | `string -> string -> Object -> UnorderedBlockAllocator` |
| `compact()` | 尝试压缩小块 | `void -> UnorderedBlockAllocator` |

## 分配策略

### `allocateForWrite(sizeHint)`

`allocateForWrite(sizeHint)` 返回分配结果对象：

| 字段 | 描述 | 类型 |
|---|---|---|
| `blockId` | 目标块 ID | `string` |
| `block` | 目标块实例 | `FileBlock` |
| `created` | 是否新建块 | `boolean` |
| `oversized` | 是否超出 `maxBlockSize` | `boolean` |
| `remainingSpace` | 分配时剩余空间 | `number` |

### 选块规则

- 当 `sizeHint <= maxBlockSize` 时（贪心策略）：
1. 按剩余空间升序排列已有块
2. 选择第一个可容纳该写入的块
3. 若不存在可容纳块，则新建块

- 当 `sizeHint > maxBlockSize` 时：
1. 直接分配独立新块
2. 该文件独占该块

该策略属于局部最优的贪心分配：优先填充“刚好能放下”的块，以减少碎片并提高块空间利用率。

## 模块特点

- 面向逻辑文件 ID 提供统一读写，不依赖调用方感知具体块文件名。
- 默认块大小目标为 8KB~16KB，适配白板对象聚合存储场景。
- 块大小约束仅由 `UnorderedBlockAllocator` 负责，`FileBlock` 仅负责块内容增删改查。
- 支持“超大文件独占块”，避免干扰普通块分配。
- 支持块级分裂、合并和 compact，便于长期运行后的空间整理。
- `autoFlush` 可切换“实时持久化”与“批量持久化”。

## 注意事项

- 当前实现不处理并发写入；多进程场景需要外部锁。
- `sizeHint` 是分配提示值，真实写入大小以序列化结果为准。
- 即使估算命中，若真实写入仍超限，`addFile` 会自动回退到新块。
- `autoFlush: false` 时，未手动 `flush()` 的内容不会持久化。