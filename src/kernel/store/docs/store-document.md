# 会话存储内核文档

本文档提供 kernel 会话存储（`src/kernel/store/`）的概述与实现语义：白板会话的存储布局、增量落盘与恢复。白板文件结构的完整说明见[文件结构文档](../../../docs/file-structure.md)，两文档互补，本文档只约束内核模块机制。

> [!NOTE]
>
> **当前状态**：per-source 日志流存储（journaler 按 record.source 写 `hit/{source}/`，加载时多流归并重建 hit 树）、对象文件写权仲裁（远程活动对象跳过、部分驻留写端关闭缺失移除）、元数据分片与离线语义（`meta/{source}.json` 按写端分片、GUI 断线续编与单机降级开板、CLI 无 daemon 自治写）、会话恢复（树重放 + 层叠图回填 + id/时间续号）与跨会话撤销均已落地并固化为回归测试。chunks/ 经实测定夺**保留落盘**（万级对象：chunks/ 直读 409ms vs 回放派生 3625ms，详见文件结构文档的决策注记）。待落地：大板场景的区块懒加载接入演示流程。

## 模块定位

会话存储是内核的持久化子系统。依据内核分层约定（见 [core-modules.md](../../../docs/core-modules.md)）：内核零 canvas/DOM，持久化的**逻辑**写在 kernel，文件操作原语（read/write/ls/exists/rm/mv/mkdir）从外部注入：

- `host`（组合根）：选路径 → registerRoot → bindRoot → 注入内核
- `kernel/store/session-store.js`：布局语义，create/open/save 编排、对象/trash/段文件读写
- `kernel/store/journaler.js`：日志跟随者，flush 时增量写段 + 对象/trash/区块文件 + board.json
- `io/driver/`：memory / node / tauri 三实现，纯执行，不做任何判断

## SessionDriver 契约

kernel 以结构化 typedef 定义最小文件操作接口，不 import io 包；io 包的 `bindRoot` 输出天然满足该结构。依赖方向单向：io → kernel。

所有驱动方法不抛业务错误：失败返回 null/false/[]。

## 存储布局

布局（详见[文件结构文档](../../../docs/file-structure.md)）：

```text
{board}/
  board.json                       # 板级元数据（格式版本、boardConfig；创建时写一次，之后只读）
  meta/{source}.json               # per-source 元数据分片（计数与时间水位）
  objects/{objectId}.json          # 存活对象快照
  trash/{objectId}.json            # trash 条目（含层位边）
  chunks/{chunkId}.json            # 区块元数据（层叠图与覆盖索引）
  hit/{source}/seg-{NNNNNN}.jsonl  # per-source 操作日志流
```

对象 id 含斜杠，文件名经 `encodeURIComponent` 编码；source 流目录名同样编码。段序号为六位十进制零填充，各流内单调递增、跨流独立。

CLI 在板目录另维护 `.cli-choices.json`（choice 驻留种子），不属内核布局，不进日志也不进 board.json。

## 落盘语义（日志跟随者）

journaler 订阅操作日志的 append 事件——本地 commit 与远端应用共用同一入日志通道，订阅者由此观察到全部新增记录，无需逐类型效果逻辑。

- **合批**：记录入队后经微任务合批自动落盘；`flush()` 提供可等待的排空洞；`detach()` 退订并排空。
- **flush 编排**：新记录按 record.source 分组写为各源流的日志段（原子写：临时文件 + rename）→ 对象/trash 文件调和 → 区块元数据调和 → 写 source 元数据分片。
- **失败与重试**：驱动返回 false 或抛错时不得更新对应成功指纹；日志段保留队首，对象、trash、区块与元数据保留下轮重试。显式 `flush()` 汇总各阶段失败并 reject，串行链仍可继续后续 flush；daemon 仅在应落盘内容全部成功后回复 RPC 成功。
- **流归并**：打开板时各 per-source 流按「source 分组、组内操作序号升序、id 去重、组按 source 字典序拼接」归并——满足操作日志 per-source 序号连续与时间单调的准入校验；树重建按 (时间, author) 确定性定序，与归并顺序无关。
- **指纹调和**：对象与区块文件按板当前状态对齐——序列化指纹（JSON 串）比对，仅写差异；遍历 `objectLoaded` 注册表写入 `objects/`（未驻留区块中的对象不在该表内，故部分驻留写端必须关闭缺失移除，见写权仲裁），trash 条目写 `trash/`（层位边集合归一化为数组），既不在该表内亦非 trash 的对象从盘上移除。撤销/重做/远端记录引起的任意状态迁移统一收敛。注意此处的「活动对象」指内存中在场对象，与 AOM 三态术语中的「活动对象」不是一回事（AOM 活动态是被选中、正在操作的对象）。
- **写权仲裁**：远程活动对象（AOM `isRemoteActive`）跳过不写不移除——写权属活动方；部分驻留写端（GUI 开 chunkUnload）以 `removeMissing:false` 关闭缺失移除；日志流按 `persistStream` 过滤：GUI 只落本端 source 的流，daemon 落自己与 relay 远端来源的流、不落直连客户端流；元数据按 source 分片（`meta/{source}.json`：本端 + 本会话代写过流的来源）；读会话以 `writeMeta:false` 保持零写盘。
- **指纹种子**：打开既有板时以盘上内容为种子挂接（含各源流的下一段序号 `nextSegmentSeqBySource`，由各流目录内最大段序恢复），首轮 flush 不做无谓重写。

## 会话恢复

打开既有板（构造 BoardCore 时传入会话选项，随后 `restoreSession`）：

1. `hitRecords` 经 `OperationLog.fromJSON` 重建日志，`UndoTree.rebuild()` 重建时间回溯树——撤销/重做历史穿越重开。
2. `lastTime` 续给 commit 边界的时间标记，`coreIdCounters` 续给 Core 侧对象 id 分配器，`objectIdCounters` 续给 UI 侧对象 id 池（UI 经 `reportObjectIdCounter` 上报，随板元数据持久化）。
3. `restoreSession` 回填区块层叠图与覆盖索引、注册对象实例、恢复 trash 条目；恢复的区块标记完整加载态（层叠图与对象已从盘上就绪，不再走懒加载等待）。

## 关键设计点

- **日志即变更馈送**：一切变更过 commit 边界进 append-only 日志且记录携带全量快照，落盘只需跟随日志增长，无需脏跟踪。
- **调和优于效果推导**：对象/区块文件以板当前状态为准做指纹调和，撤销、重做、远端应用引起的迁移自动正确。
- **id 计数进元数据**：id 分配单调不回拨；现存 id 会随 trash 清空或撤销消失，而日志永远引用它们，故计数器显式入 meta、开板读回，不依赖扫描现存 id。
- **崩溃窗口**：上报与提交经同一 RPC 通道保序，任何包含新增记录的落盘批次其元数据不落后于记录。

## 设计约束

- 选择状态（活动对象集合）不随会话持久化，重开后为空。
- 区块只增不减：已卸载区块的元数据文件保留在盘上。
- 大板场景的区块懒加载读写路径存在但未接入演示流程。[todo]

## 相关文档

- [file-structure.md](../../../docs/file-structure.md)
- [operation-document.md](../../hit/docs/operation-document.md)
- [undo-tree-kernel-document.md](../../hit/docs/undo-tree-kernel-document.md)
- [board-core-document.md](../../board/docs/board-core-document.md)
- [src/io/README.md](../../../io/README.md)
