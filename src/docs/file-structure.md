# 白板文件结构文档

本文档整理当前代码中**可以被源码直接验证**的白板文件结构与持久化语义。

需要特别说明：

- 这份文档描述的是 kernel 会话存储（`src/kernel/store/`）与 io 持久化适配器（`src/io/adapter/`）共同约定的布局
- 默认 Worker runtime 以 `rootPath` 是否有效区分内存模式与持久化模式
- 内存模式下不落任何文件；持久化模式下根目录即板目录

## 概述

持久化相关代码分三层：

1. **kernel 定义缝**：`kernel/board/persistence-adapter`（区块元数据与对象读写契约）、`kernel/store/session-store` 的 `SessionDriver`（最小文件操作契约）
2. **io 包实现缝**：`io/driver/`（memory / node / tauri 三实现）、`io/adapter/persistence`（PersistenceAdapter 实现）
3. **host 组合根接线**：core-worker `createBoard` 注册根目录、构造 BoardCore、恢复会话并挂接日志跟随者

板目录结构（formatVersion 1）：

```text
{board}/
  board.json                        # 板级元数据（创建时写一次，之后只读）
  meta/{source}.json                # per-source 元数据分片（计数与时间水位）
  objects/{objectId}.json           # 对象快照
  trash/{objectId}.json             # trash 条目
  chunks/{chunkId}.json             # 区块元数据
  hit/{source}/seg-{NNNNNN}.jsonl   # per-source 操作日志流
  .daemon.json                      # 持板 daemon 探测文件（daemon 运行时存在）
```

> [!NOTE]
>
> `.daemon.json` 由持板 daemon 进程维护（name/port 等连接信息，停止时清理），不属于 kernel store 布局本身；GUI 开板时由 core-worker 的建板流程读取（探测活 daemon），用户在板目录中会看到该文件。

## 各文件与目录说明

### `board.json`

板级元数据文件。**创建时写一次，之后只读**（多写者共板的冲突面由此归零）。

```json
{
  "formatVersion": 1,
  "boardConfig": { "width": 4096, "height": 4096 }
}
```

字段含义：

- `formatVersion`：布局版本号
- `boardConfig`：板宽高；板尺寸是文档数据（决定区块划分），恢复时以盘上配置为准
- `lastTime` / `coreIdCounters` / `objectIdCounters`（存量兜底）：新写入落在 `meta/{source}.json` 分片；读取时板级字段与分片归并（计数按 key 并入，lastTime 取全源最大）
- `nextSegmentSeq`（已退役）：v1 单流的全局段序号；per-source 流的下一段序号由各流目录内最大段序直接恢复

### `meta/{source}.json`

per-source 元数据分片（原子写）。各写端只写自己负责的分片：本端 + 本会话代写过日志流的来源（daemon 代写 relay 远端来源）。

```json
{
  "lastTime": 1786009532137,
  "coreIdCounters": { "dev-8f3a": 2 },
  "objectIdCounters": { "dev-8f3a": 17 }
}
```

- `lastTime`：该写端已落盘记录的最晚时间标记
- `coreIdCounters` / `objectIdCounters`：仅该 source 的计数切片，重开时续号防碰撞

### `objects/{objectId}.json`

活动对象的序列化快照，扁平存储，每对象一文件。

对象 id 含斜杠（如 `demo/1`），文件名经 `encodeURIComponent` 编码（如 `demo%2F1.json`）。

落盘由日志跟随者按状态调和（见『日志跟随者』）。

### `trash/{objectId}.json`

trash 条目文件，文件名编码规则与活动对象相同。内容为完整条目：

```json
{
  "data": { "id": "demo/2", "type": "StrokeObject", "...": "..." },
  "chunks": [{ "chunkId": "1", "below": ["demo/1"], "above": [] }]
}
```

- `data`：删除时刻的全量序列化
- `chunks`：删除时刻各区块的层位边（`below` / `above` 为该对象在区块静态图中的前驱与后继）

层位边使跨会话的撤销删除能把对象按原层位关系回图。

### `chunks/{chunkId}.json`

区块元数据文件：

```json
{
  "tierGraph": [],
  "objectCoverIndex": []
}
```

- `tierGraph`：区块静态层叠图的数组化结果（`DirectedGraph.toArray()`）
- `objectCoverIndex`：对象覆盖区块索引，`Array<[objectId, number[]]>`（盘上恒为空——覆盖索引权威副本在 BoardCore，重开时由 tierGraph 节点集表达归属）

落盘由日志跟随者按状态调和（见『日志跟随者』）。

> [!NOTE]
>
> **chunks/ 保留落盘（2026-08-15 实测定夺）**：曾评估「chunks/ 停止落盘、加载时从对象与日志派生重建」（分片布局的写冲突消除动议）。万级对象实测（`yarn bench:chunk`，10,000 对象 / 11,351 条记录）：基线（chunks/ 直读 + restoreSession）409ms，全量回放派生 3625ms（约 9 倍，且随历史长度无限增长，违反「打开耗时与历史操作数脱钩」）；chunks/ 读取本身仅 3.3ms，零收益。双写软冲突由原子写与收敛内容兜底。
>
> 注记时曾存在的「实况提交与重放派生的 z-order 语义差」已随层位边效果记录消除：对象操作记录携带提交/提取时刻的层位边（below/above），回放与远端直接应用记录边而不做几何重算；记录之外的相交对象按先后缝合——正放缝后写者居上、历史恢复缝较晚物化者居上。同夹具复测（2026-08-15）：相交对层位反转为 0（两路视觉等价），非相交对的绘制序换位属插入序副产物、视觉无关。旧日志形态（记录未携带层位边）回退几何居上派生。

### `hit/{source}/seg-{NNNNNN}.jsonl`

操作日志流：每个写端进程按自己的 source 独占一个流目录（目录名经 `encodeURIComponent` 编码），只追加自己的段，流内段序号独立递增。段写入为原子写（临时文件 + rename），崩溃不留撕裂段。`hit/` 下的散文件（非流目录）一律不读。

段内容为 JSONL：一行一条序列化操作记录（分子操作记录结构见 [operation-document.md](../kernel/hit/docs/operation-document.md)）。

打开板时归并全部流：按 record.source 分组、组内按操作序号升序、按 id 去重，组按 source 字典序拼接，经 `OperationLog.fromJSON` 重建日志、`UndoTree.rebuild()` 重建时间回溯树（树按 (时间, author) 确定性定序，与归并顺序无关），撤销历史由此穿越重开。

## 落盘语义

### 日志跟随者

`kernel/store/journaler` 订阅操作日志的 append 事件（本地 commit 与远端应用共用同一入日志通道），微任务合批后自动落盘。每轮 flush 按序执行：

1. 队列中的新记录按 record.source 分组，每组写为一段 `hit/{source}/seg-{N}.jsonl`（各写端只写自己的流；daemon 代写 relay 远端来源的流）
2. 对象文件调和：板上现存的非 trash 对象（含非活动层成员）写 `objects/`，trash 条目写 `trash/`，板上已不存在的对象文件从盘上移除；**写权仲裁**——远程活动对象（AOM `isRemoteActive`）跳过不写不移除（写权属活动方）；部分驻留写端（GUI 开 chunkUnload）以 `removeMissing:false` 关闭缺失移除，防止误删未加载对象的文件
3. 区块元数据调和：层叠图与覆盖索引指纹比对，仅写差异
4. 写本端（与代写来源）的 `meta/{source}.json` 分片；读会话以 `writeMeta:false` 保持零写盘

调和以板当前状态为准，撤销/重做/远端记录引起的任意状态迁移统一收敛，无逐类型效果逻辑。

### 写权矩阵（现行布局）

| 文件                                    | 谁写                                                   | 冲突兜底                           |
| --------------------------------------- | ------------------------------------------------------ | ---------------------------------- |
| `board.json`                            | 创建者一次，之后只读                                   | —                                  |
| `meta/{source}.json`                    | 该 source 的写端（含代写其流的 daemon）                | 硬隔离零冲突；原子写               |
| `objects/{id}.json` / `trash/{id}.json` | 活动方（AOM 仲裁，远程活动跳过）；静态对象双侧指纹调和 | 原子写 + digest 对账               |
| `hit/{source}/`                         | 仅该 source 进程                                       | 硬隔离零冲突；段序号占用时递增自愈 |
| `chunks/{chunkId}.json`                 | 各写端指纹调和（收敛后内容相同）                       | 原子写                             |

### 会话恢复

打开既有板（core-worker `createBoard` 携带有效 `rootPath`）：

1. `registerRoot` 注册根目录（`~` 家目录展开；目录不存在且声明写权限时自动创建）
2. `loadAll` 聚合读取板元数据、日志记录、区块元数据、对象与 trash
3. 构造 BoardCore：`hitRecords` 重建日志与树、`lastTime` 与 `coreIdCounters` 续号
4. `restoreSession` 回填层叠图与覆盖索引、注册对象实例、恢复 trash 条目；恢复的区块标记完整加载态
5. 挂接日志跟随者（以盘上内容为指纹种子，避免首轮重写）

### 安全边界

webview 与 worker 只构造受限意图（`rootId` + 相对路径），root 注册表、路径校验、符号链接边界与权限强制全部在 Rust（`src-tauri/src/commands/`）。详见 [src/io/README.md](../io/README.md)。

## 当前已知约束

- 选择状态（活动对象集合）不随会话持久化，重开后为空
- 区块只增不减：已从板上卸载的区块其元数据文件保留在盘上
- 大板场景的区块懒加载读写路径（`loadChunkObjectEntries` 等）存在但未接入演示流程

## 相关文档

- [src/io/README.md](../io/README.md)
- [operation-document.md](../kernel/hit/docs/operation-document.md)
- [undo-tree-kernel-document.md](../kernel/hit/docs/undo-tree-kernel-document.md)
- [board-core-document.md](../kernel/board/docs/board-core-document.md)
- [core-data-model.md](./core-data-model.md)
- [core-overview.md](./core-overview.md)
