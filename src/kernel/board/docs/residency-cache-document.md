# owner 驻留缓存文档

## 概述

`OwnerResidencyCache` 是 owner（当前为 daemon）部分驻留时的区块工作集。它以区块为粒度持有对象实例：区块被 FULL 持有时其静态图全部节点驻留，释放后按覆盖计数驱逐对象。磁盘正确性由 journaler 的驻留无关活性判定（K2）与回放/写边前的共驻留（K3）保证，缓存只负责内存窗口。

模块：`src/kernel/board/residency-cache.js`。

## 接口

| 成员 | 说明 |
| --- | --- |
| `createOwnerResidencyCache(boardCore, { maxChunks, requesterId })` | 创建缓存；`maxChunks` 默认 32，`requesterId` 默认 `"owner-cache"` |
| `budget` | FULL 持有区块预算 |
| `ensureObjects(objectIds)` | 按对象覆盖索引加载所在区块 |
| `ensureChunks(chunkIds)` | 加载缺失区块、更新 LRU、执行驱逐 |
| `stats()` | `{budget, fullChunks, residentObjects, pinnedChunks}` |
| `destroy()` | 释放全部持有 |

`BoardCore.setResidencyManager(cache)` 挂接后，`ensureObjectsResident` / `ensureChunksResident` 会优先交给缓存；未挂接时 BoardCore 使用临时 loader（`destroy(300)` 释放），供 GUI 等部分驻留端按 route 临时加载。

## 驱逐规则

- **区块粒度**：LRU 从最久未访问的区块开始；当前操作需要的区块与 `boardCore.getPinnedChunkIds()` 不驱逐。
- **AOM 固定**：活动对象、被 pickup 纳入的非活动层成员、远程选择成员所在区块都固定；预算因此允许临时超出，下一次 `ensureChunks` 收敛。
- **跨区块对象**：对象在任一覆盖区块 FULL 时保持驻留；`unloadChunkObjectEntries` 按剩余 FULL 覆盖数重新计算。
- **销毁顺序**：daemon 关闭时先 `session.flush()` / `session.close()`，再 `cache.destroy()`，避免未落盘修改因驱逐丢失。

## daemon 接线

- owner 启动与 GUI→daemon 交接都经 `openBoardSession({ partialResidency: true })` 打开：不读对象文件、区块 TEMP 恢复、设置类型索引加载器。
- `startBoardDaemon({ residentChunks })`（CLI `--resident-chunks`）决定预算；proxy 模式不创建缓存。
- `handleOwnerRpc` 经 `invokeBoardApiRoute` 在路由前准备驻留；`queryObjectList` 首次调用扫描 `objects/` 生成类型索引，`undo`/`redo` 按过渡记录点名的区块准备。
- 探针：`node --expose-gc dev/probes/daemon-memory.mjs --owner-cache --resident-chunks 2` 输出开板与 touch 后的驻留对象/已载区块。

## 相关文档

- [board-core-document.md](./board-core-document.md)（TEMP 恢复、驻留 API）
- [store-document.md](../../store/docs/store-document.md)（`loadAll` 按需加载）
- [cli-document.md](../../../cli/docs/cli-document.md)（daemon 使用面）
