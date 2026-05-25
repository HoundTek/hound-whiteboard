# io-for-renderer 文档

本文档介绍 src/utils/filesys/renderer-io.js 与 src/utils/filesys/accumulatable-io.js，并重点说明它们相对于 src/utils/filesys/io.js 的 API 差异、性能差异与实现方式。

## 模块定位

- io.js：运行在主进程或 Node 环境中的真实文件系统实现，直接调用 fs、path、adm-zip 与 hidefile。
- renderer-io.js：运行在渲染进程中的异步代理层，保留 Directory 与 File 的大部分对象手感，但真正的 I/O 通过 preload 暴露的 IPC bridge 发往主进程执行。
- accumulatable-io.js：运行在渲染进程中的批量代理层，API 风格接近 renderer-io.js，但会先把操作积压在对象本身，等到 flush 或 flushAll 时再统一提交。

## 与 io.js 的 API 差异

### renderer-io.js

renderer-io.js 的目标是尽量贴近 io.js 的 API 形状，因此 Directory、File、静态 parse、路径拆分逻辑、对象间转换方式都保持一致。但有两个关键变化：

- 所有真正触发文件系统访问的方法都变成异步方法，需要 await。
- 纯路径计算方法仍然同步，例如 getPath、cd、father、peek、parse、getHideResult、getUnHideResult。

常见对比如下：

| 能力 | io.js | renderer-io.js |
|---|---|---|
| Directory.exist() | 同步返回 boolean | 异步返回 Promise<boolean> |
| File.cat() | 同步返回 string | 异步返回 Promise<string> |
| File.writeJSON() | 同步返回 File | 异步执行，await 后返回当前 File |
| Directory.lsFile() | 同步返回 File[] | 异步返回 Promise<File[]> |
| getPath、cd、peek | 同步、本地计算 | 同步、本地计算 |

这意味着从 io.js 迁移到 renderer-io.js 时，主要改动不是对象模型，而是调用时序：凡是实际读写磁盘的方法，都需要进入异步流程。

### accumulatable-io.js

accumulatable-io.js 和 io.js 的差异更大一些，因为它不仅异步，而且是“延迟执行”的。

- 大多数 I/O 方法不会立刻执行，而是把操作记录到 pendingOperations 中。
- flush(count) 会提交前 count 个积压操作。
- flushAll() 会提交当前对象上的全部积压操作。
- flush 系列返回的是“本次提交得到的结果数组”，而不是单个结果。

示例：

```js
const file = new File(docsDir, "note", "txt");

file.exist();
file.cat();

const results = await file.flushAll();
// results[0] 是 exist() 的结果
// results[1] 是 cat() 的结果
```

因此，accumulatable-io.js 更适合“先描述一串操作，再统一发送”的场景，而不适合每一步都依赖前一步即时返回值的场景。

## 性能差异

性能差异主要来自 IPC 次数，而不是路径对象本身。

### io.js 与 renderer-io.js

io.js 直接在当前进程调用 fs，因此没有 preload、序列化、ipcMain.handle、ipcRenderer.invoke 这层往返成本。

在现有 benchmark 中，renderer-io.js 相比 io.js 的主要额外成本来自：

- 目标对象序列化
- 参数序列化
- 渲染进程到主进程的一次 IPC 往返
- 返回结果反序列化

实际表现上，简单高频操作通常会明显慢于 io.js；此前 direct 与真实 roundtrip 的对比里，这类操作常见会有数倍级差距。原因并不是文件系统本身更慢，而是单次调用的固定桥接成本被放大了。

### renderer-io.js 与 accumulatable-io.js

accumulatable-io.js 的收益来自“减少 IPC 次数”。如果连续执行多个小操作，把它们合并成一次 batch，通常会优于 renderer-io.js 的逐次 invoke。

当前 benchmark 的代表性结果如下：

| 场景 | renderer-io.js | accumulatable-io.js | 结论 |
|---|---|---|---|
| File.exist + cat + catJSON | 6102.21 ops/sec | 7920.79 ops/sec | 小操作组合收益明显 |
| Directory checks，400 files | 701.02 ops/sec | 713.78 ops/sec | 目录扫描本体占主导，收益较小 |
| burst writeJSON，20 次写入 | 317.21 ops/sec | 378.79 ops/sec | 多次连续写入收益明显 |
| large read mix，2000 objects | 230.85 ops/sec | 239.95 ops/sec | 大读操作收益有限 |

可以把这组结果总结为：

- 小而频繁的操作，batch 化收益最明显。
- 真正耗时的是大目录遍历或大 JSON 解析时，IPC 优化只能带来边际改善。
- accumulatable-io.js 不会让单次 I/O 变快，它只是降低“多次调用的固定桥接开销”。

## 实现方式

### renderer-io.js 的实现

renderer-io.js 的核心是“本地对象外壳 + 远程方法调用”。

关键步骤如下：

1. 渲染进程里的 Directory 与 File 仍然维护本地路径状态，例如 paths、dir、name、extension。
2. 纯路径操作直接在本地完成，不经过主进程。
3. 遇到真实 I/O 方法时，通过 callIOMethod 构造请求。
4. 请求会先把 Directory/File 序列化为普通对象，例如包含 __houndType、paths、dir、name、extension。
5. preload-io.js 暴露的 __houndIOBridge.call 会把请求发到主进程。
6. 主进程的 io bridge handler 反序列化对象，调用 io.js 中真实的方法，再把结果序列化返回。
7. 渲染进程收到响应后反序列化，重新变回 Directory、File 或普通值。

这种设计的好处是 API 手感接近 io.js，渲染层不必直接持有 fs 权限；代价是每次 I/O 都有一次完整 IPC 往返。

### accumulatable-io.js 的实现

accumulatable-io.js 在 renderer-io.js 的基础上，又多了一层“延迟执行队列”。

关键机制如下：

1. 所有可积压对象都继承自 AccumulatableIOBase。
2. 每次调用 exist、cat、writeJSON、lsFile 等方法时，不会立刻发 IPC，而是调用 enqueue(method, args) 把操作压入 pendingOperations。
3. flush(count) 从队列中取出前 count 个操作；flushAll() 则取出全部。
4. 这些操作会通过 __houndIOBridge.callBatch 一次性发送给主进程。
5. 主进程顺序执行批量操作，并返回两部分内容：
   - results：每个操作的结果数组
   - target：执行完成后的目标对象最终状态
6. 渲染进程拿到响应后，会先用 results 生成调用结果，再用 target 回写当前对象状态，确保 hide、mv、unhide 之类会修改路径状态的方法也能同步到本地对象。

这个模型解释了为什么 flush 的返回值是数组，也解释了为什么它适合“批量提交命令”，而不是传统的“每个方法立即得到返回值”。

## 何时选用

- 选 io.js：代码运行在主进程或纯 Node 环境，而且需要最直接、最低成本的文件系统访问。
- 选 renderer-io.js：代码运行在渲染进程，需要 API 接近 io.js，同时业务逻辑本身就是一步一步 await 的。
- 选 accumulatable-io.js：代码运行在渲染进程，而且存在明显的连续小 I/O、批量写入、批量检查或批量读取需求，希望减少 IPC 次数。

## 注意事项

- renderer-io.js 和 accumulatable-io.js 都依赖 preload-io.js 注入的 __houndIOBridge；如果 preload 未加载，模块会直接报错。
- accumulatable-io.js 的积压队列是“绑定在对象实例上”的，不同实例之间不会自动合并 batch。
- 如果操作之间存在强依赖，并且后一步必须立即消费前一步的返回值，那么 renderer-io.js 往往比 accumulatable-io.js 更直接。
- 如果需要最大性能，优先减少跨进程边界次数；仅靠优化对象封装本身，收益通常很有限。