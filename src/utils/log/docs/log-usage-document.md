# 日志系统 - 用法文档

本文档提供 `src/utils/log/` 的使用说明。

## 模块定位

`utils/log/` 提供一套基于 EventBus 的日志体系，覆盖日志产生、分发、缓冲和消费四个环节。前端代码通过 Logger 记录日志，日志总线（LogBus）将条目分发给多个消费者，重量级消费者可通过 ThrottledBus 缓冲后批量处理。

## 快速开始

### 在任意模块中记录日志

```js
import { Logger } from "./utils/log/logger.js";
import { logBus } from "./utils/log/log-bus.js";

const log = new Logger("MyModule", "INFO", logBus);

log.info("Application started");
log.warn("Configuration missing, using defaults");
log.error("Failed to load file:", err);
```

### 创建子 Logger（继承命名空间和级别）

```js
const sub = log.child("SubComponent");
sub.info("Specific message"); // logger → "MyModule:SubComponent"
```

### 调试日志（带自适应降采样）

```js
// 仅在开发环境、不频繁时才会输出
log.debug("Dirty rects:", dirtyRects);
```

密集循环中每秒调用数百次的 debug 日志会被自动降采样。

### 源头节流（重复告警用）

```js
// 200ms 窗口内同 key 只记一次
log.throttledWarn("chunk-miss", "Chunk not found", chunkId);
log.throttledError("disk-full", "No space left on device");
```

## 全局初始化

在应用入口 `main.js` 中：

```js
import { Logger } from "./utils/log/logger.js";
import { logBus } from "./utils/log/log-bus.js";
import { createConsolePrinter } from "./utils/log/console-printer.js";

// 创建根 Logger
const log = new Logger("HWB", "INFO", logBus);

// 挂载控制台输出器（默认订阅，带时间戳）
createConsolePrinter(logBus, { timestamps: true });
```

## API 参考

### Logger

| 方法                           | 说明                         | 过滤条件                          |
| ------------------------------ | ---------------------------- | --------------------------------- |
| `log.info(...)`                | 信息级别                     | `level ≤ INFO`                    |
| `log.warn(...)`                | 警告级别                     | `level ≤ WARN`                    |
| `log.error(...)`               | 错误级别                     | `level ≤ ERROR`                   |
| `log.debug(...)`               | 调试级别，**启用自适应采样** | `level ≤ DEBUG` 且采样通过        |
| `log.throttledWarn(key, ...)`  | 按 key 节流的警告            | `level ≤ WARN` 且 key 未在窗口内  |
| `log.throttledInfo(key, ...)`  | 按 key 节流的信息            | `level ≤ INFO` 且 key 未在窗口内  |
| `log.throttledError(key, ...)` | 按 key 节流的错误            | `level ≤ ERROR` 且 key 未在窗口内 |
| `log.child(name, meta?)`       | 创建子 Logger                | —                                 |
| `log.setLevel(level)`          | 运行时更改级别               | —                                 |
| `log.setBus(bus)`              | 切换 LogBus                  | —                                 |

**构造函数参数**：

```js
new Logger(name, level?, bus?)
```

- `name` — Logger 命名空间，如 `"Viewport"`、`"HWB"`、`"safe-io"`。
- `level` — 可选，默认 `LEVELS.INFO`。支持字符串 `"DEBUG"` 或数值 `0`。
- `bus` — 可选，LogBus 实例。不传时 fallback 到原生 `console`。

**日志条目结构**（emit 到 LogBus 的数据）：

```js
{
  timestamp: 1718700000123,   // Date.now()
  level: "WARN",              // "DEBUG" | "INFO" | "WARN" | "ERROR"
  logger: "MyModule:Sub",     // 命名空间路径
  args: ["Chunk not found", 5], // 原始参数
  meta: { throttled: true, throttleKey: "chunk-miss" }
}
```

### LogBus

| 方法                            | 说明                             |
| ------------------------------- | -------------------------------- |
| `bus.on(level, handler)`        | 订阅指定级别，返回取消函数       |
| `bus.onAny(handler)`            | 通配符订阅所有级别，返回取消函数 |
| `bus.onLevel(level, handler)`   | 同 `on`，语义更清晰              |
| `bus.onLevels(levels, handler)` | 订阅多个级别，一次性返回取消函数 |
| `bus.emit(level, entry)`        | 发射日志条目                     |

**全局单例**：

```js
import { logBus } from "./utils/log/log-bus.js";
```

### ThrottledBus

```js
const writer = new ThrottledBus({
  flushInterval: 1000, // 定时刷出间隔
  maxBufferSize: 200, // 缓冲区上限
  onFlush: (batch) => {
    // batch: 攒批的 entry 数组
    appendToFile(batch.map(JSON.stringify).join("\n"));
  },
});

// 挂到 LogBus
writer.subscribe(logBus);
// 或指定级别
writer.subscribe(logBus, ["WARN", "ERROR"]);
```

| 方法                             | 说明                     |
| -------------------------------- | ------------------------ |
| `bus.write(entry)`               | 写入一条日志             |
| `bus.subscribe(logBus, levels?)` | 自动从 LogBus 接收并写入 |
| `bus.flush()`                    | 手动触发刷出             |
| `bus.shutdown()`                 | 刷出剩余条目并清理定时器 |

`stats` 属性记录收发统计：`{ received, flushed, dropped }`。

### RingBuffer

```js
const ring = new RingBuffer(500);
ring.subscribe(logBus); // 接收所有级别，永不降采样

// 崩溃时导出
const recent = ring.dump();
const errors = ring.dumpByLevel("ERROR");
```

| 方法                              | 说明                       |
| --------------------------------- | -------------------------- |
| `ring.push(entry)`                | 写入                       |
| `ring.dump()`                     | 按时间顺序导出所有条目     |
| `ring.dumpByLevel(level)`         | 按级别筛选导出             |
| `ring.subscribe(logBus, levels?)` | 自动从 LogBus 接收         |
| `ring.clear()`                    | 清空                       |
| `ring.length`                     | 当前有效条目数             |
| `ring.totalPushed`                | 累计写入总数（含被覆盖的） |

### createConsolePrinter

```js
import { createConsolePrinter } from "./utils/log/console-printer.js";

// 默认输出所有级别，带时间戳
createConsolePrinter(logBus, { timestamps: true });

// 只输出 ERROR
createConsolePrinter(logBus, { timestamps: false, levels: ["ERROR"] });

// 返回取消函数
const off = createConsolePrinter(logBus);
off(); // 取消订阅
```

### LogRateTracker

```js
import { LogRateTracker } from "./utils/log/rate-tracker.js";

const tracker = new LogRateTracker(1000); // 1s 窗口
tracker.subscribe(logBus);

// 定期查询各 Logger 的发射速率
setInterval(() => {
  console.table(tracker.getRates());
  // → [{ name: "HWB", rate: 1.5, total: 3 }, ...]
}, 1000);
```

## 常见场景

### 场景一：模块初始化

```js
const log = new Logger("Viewport", "INFO", logBus);

function init() {
  log.info("Initializing viewport...");
  // ...
  log.info("Viewport ready", { width: 800, height: 600 });
}
```

### 场景二：子模块细分

```js
// 父 Logger 只写一次 level 和 bus
const monLog = new Logger("Viewport", "DEBUG", logBus);

// 各子模块继承
const renderLog = monLog.child("ViewportRenderer");
const inputLog = monLog.child("Input");

renderLog.debug("Dirty rects:", rects);
inputLog.warn("Unhandled signal:", signal);
```

### 场景三：高频调试日志

```js
// 60fps 渲染循环中，debug 日志被自动降采样
function renderFrame() {
  renderLog.debug("Rendering frame", frameId);
  renderLog.debug("Objects:", objects.length);
  // 实际可能 60次/秒 → 只有 3~5次/秒 过线
}
```

### 场景四：重复告警抑制

```js
// 视口平移时不断触发，但 200ms 内只记一次
log.throttledWarn("chunk-miss", `Chunk ${chunkId} not found`);
```

### 场景五：文件日志

```js
const fileLog = new ThrottledBus({
  flushInterval: 2000,
  maxBufferSize: 100,
  onFlush: (batch) => {
    const text =
      batch
        .map(
          (e) =>
            `${new Date(e.timestamp).toISOString()} [${e.level}] ${e.logger}: ${e.args.join(" ")}`,
        )
        .join("\n") + "\n";
    fs.appendFile("app.log", text);
  },
});
fileLog.subscribe(logBus);
```

### 场景六：崩溃日志导出

```js
const ring = new RingBuffer(1000);
ring.subscribe(logBus);

// 捕获未处理异常时导出
window.addEventListener("error", (event) => {
  const dump = ring.dump();
  saveCrashReport({
    error: event.error?.stack,
    recentLogs: dump,
  });
});
```

## 级别说明

| 级别   | 值  | 生产 | 开发 | 说明                         |
| ------ | --- | ---- | ---- | ---------------------------- |
| DEBUG  | 0   | 关闭 | 开启 | 调试细节，高频时自适应降采样 |
| INFO   | 1   | 开启 | 开启 | 常规运行态信息               |
| WARN   | 2   | 开启 | 开启 | 非预期但可恢复的情况         |
| ERROR  | 3   | 开启 | 开启 | 需关注的问题                 |
| SILENT | 4   | —    | —    | 关闭所有日志                 |

生产环境建议设为 `"WARN"`，仅输出警告和错误：

```js
log.setLevel(process.env.NODE_ENV === "production" ? "WARN" : "DEBUG");
```

## 相关文档

- [log-internals-document.md](./log-internals-document.md) — 架构与设计原理
