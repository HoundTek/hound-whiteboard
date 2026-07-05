---
name: hound-whiteboard-benchmark-patterns
description: Hound Whiteboard 项目的 Benchmark 编写规范与模式。在需要添加、迁移或审查 benchmark 时加载。
---

# Hound Whiteboard Benchmark Patterns

## 文件位置

所有 benchmark 放在项目根目录的 `benchmarks/` 下：

```
benchmarks/
├── helpers.js                     ← 统一辅助函数
├── all.bench.js                   ← 全量运行器
├── queue.bench.js                 ← 数据结构 benchmark
├── chain.bench.js
├── io-bridge.bench.js             ← I/O 桥接层 benchmark
├── io-direct.bench.js             ← 直接文件 I/O benchmark
├── io-file-granularity.bench.js   ← 文件粒度对比（特殊表格输出）
├── io-roundtrip.bench.js          ← Electron 环境
├── io-accumulatable.bench.js      ← Electron 环境
├── worker-rpc.bench.js            ← Worker RPC 往返 benchmark
└── worker-render.bench.js         ← Worker 渲染帧 benchmark
```

## 输出格式

所有 benchmark 必须输出统一的 `x ops/sec ±% (runs sampled)` 格式：

```
modifyObject RPC 单条往返 x 1,750,771 ops/sec ±22.55% (25,000 runs sampled)
```

通过 `benchmarks/helpers.js` 的 `benchmarkSync` / `benchmarkAsync` 自动保证。

## Helper 函数 API

`benchmarks/helpers.js` 导出的所有函数：

| 函数             | 签名                                          | 说明                  |
| ---------------- | --------------------------------------------- | --------------------- |
| `benchmarkSync`  | `(label, iterations, rounds?, fn)`            | 同步函数性能测试      |
| `benchmarkAsync` | `(label, iterations, rounds?, fn)`            | 异步函数性能测试      |
| `printHeader`    | `(title)`                                     | 打印度量 section 头部 |
| `printFooter`    | `()`                                          | 打印度量 section 底部 |
| `formatResult`   | `(label, opsPerSec, variationPct, totalRuns)` | 返回格式化字符串      |
| `printResult`    | `(label, opsPerSec, variationPct, totalRuns)` | 打印格式化结果        |

### 参数说明

- `label` — 测试名称，显示在输出行中
- `iterations` — 每轮迭代次数
- `rounds` — 轮数（默认 5），影响 ±% 的可靠性
- `fn` — 被测函数。`benchmarkSync` 接收 `() => void`；`benchmarkAsync` 接收 `(i: number) => Promise<void>`

## 模式一：同步操作（benchmarkSync）

适用于纯计算、无异步调用的操作：

```js
import { printHeader, printFooter, benchmarkSync } from "./helpers.js";

printHeader("My Benchmark");

const ROUNDS = 5;

benchmarkSync("操作名称", 10000, ROUNDS, () => {
  // 被测操作
  doSomething();
});

printFooter();
```

### 选择 iterations 的原则

- 简单操作（~ns 级）：50,000 – 100,000
- 普通操作（~µs 级）：5,000 – 10,000
- 慢操作（~ms 级）：100 – 1,000
- IO 操作（含文件系统）：50 – 200

每轮总耗时应至少 **数十毫秒**，否则计时器分辨率噪声会造成 ±% 偏高。

## 模式二：异步操作（benchmarkAsync）

适用于 Promise / RPC / Worker 通信等异步路径：

```js
import { printHeader, printFooter, benchmarkAsync } from "./helpers.js";

printHeader("My Async Benchmark");

const ROUNDS = 5;

await benchmarkAsync("操作名称", 5000, ROUNDS, async () => {
  await someAsyncCall();
});

printFooter();
```

**注意**：fn 接收迭代序号 `i`，可用于区分不同次调用的数据（如唯一 ID）。如果 fn 不需要该参数，签名可以简写为 `async () => { ... }`。

## 模式三：带 Fixture 的 IO Benchmark

适用于每次操作需创建/销毁资源的场景。**注意资源泄露**：

```js
benchmarkAsync("Renderer File#cat", 80, ROUNDS, async () => {
  const fixture = createFixture();
  try {
    const rendererFile = new RendererFile(fixture.dir, "note", "txt");
    await rendererFile.cat();
  } finally {
    destroyFixture(fixture.rootPath); // ← 必须在 finally 中清理
  }
});
```

如果 fixture 可以被复用（只创建一次，后续操作不修改），可以在 benchmark 外创建，在 benchmark fn 中只执行操作部分：

```js
const fixture = createFixture();
benchmarkSync("Direct File#cat", 2000, ROUNDS, () => {
  fixture.noteFile.cat(); // 不修改 fixture
});
destroyFixture(fixture.rootPath);
```

## 运行方式

```bash
yarn bench:worker        # Worker RPC benchmark
yarn bench:render        # Worker 渲染帧 benchmark
yarn bench:io            # I/O Bridge benchmark
yarn bench:io:direct     # I/O Direct benchmark
yarn bench               # 全量 benchmark
```

全量运行器 `all.bench.js` 按顺序逐一启动子进程执行各 benchmark 文件。

## 编写新 Benchmark 的步骤

1. 在 `benchmarks/` 下创建 `*.bench.js`
2. 引入 `printHeader` / `printFooter` / `benchmarkSync` / `benchmarkAsync` 等 helper
3. 用 `printHeader("标题")` 开头
4. 根据操作类型选择 `benchmarkSync` 或 `benchmarkAsync`，传入合适迭代数
5. 用 `printFooter()` 结尾
6. 在 `all.bench.js` 的 `benchmarks` 数组中添加条目
7. 在 `package.json` 中添加对应的 `bench:*` script（可选，不必须）

## 重要注意事项

### 1. 异步函数内存管理

`benchmarkAsync` 在 loopback Worker 模式下每个 `await fn()` 产生 Promise 闭包。对于单次操作 < 1 µs 的极快操作，大量微任务堆积可能导致 OOM。建议将 iterations 限制在 5,000–10,000 范围内，配合 rounds=5 已足够获得稳定数据。

### 2. 计时器分辨率对 ±% 的影响

对于单次操作 < 10 µs 的极快操作，timer jitter 会使 ±% 偏高（10–30% 正常）。ops/sec 的均值是可靠的，±% 仅作参考。`benchmarkSync` / `benchmarkAsync` 的 rounds 越多，±% 越接近真实值。

### 3. 不要修改被测代码以适配 benchmark

benchmark 应该反映真实使用路径。例如 Worker RPC benchmark 使用了 loopback Endpoint（同一线程模拟 postMessage），而不是直接调用 `BoardCore` 的方法——这保证测量的路径与实际 Worker 模式一致。

### 4. 清理

IO benchmark 必须在 finally 中删除临时文件。OffscreenCanvas benchmark 必须在结束时调用 `restoreOffscreenCanvas?.()`。不清理会导致后续 benchmark（或测试）运行异常。

### 5. 如何测量每秒操作数

Helper 内部实现逻辑：

1. 预热 50 次（确保 JIT 编译完成）
2. 运行 `iterations` 次，记录总耗时
3. 计算 `ops/sec = iterations / (elapsed_ms / 1000)`
4. 重复 `rounds` 轮，计算均值和变异系数
5. 输出 `label x mean_ops/sec ±var% (total_runs runs sampled)`
