# 日志系统 - 用法文档

本文档提供 `src/utils/log/` 的使用说明。

## 模块定位

`utils/log/` 提供一套基于 EventBus 的日志体系，覆盖日志产生、分发和消费三个环节。前端代码通过 Logger 记录日志，日志总线（LogBus）将条目分发给多个消费者（如控制台输出器）。

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
// 仅当 level ≤ DEBUG 时输出，高频调用时自动降采样
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

仓库现状：各模块自建 Logger，例如 `src/host/core-worker.js:283` 的 `new Logger("CoreWorker", "INFO", logBus)`。控制台输出器由 `src/demo/whiteboard.js:34` 挂载全部级别，`src/host/core-worker.js:319` 另挂一份只订阅 DEBUG。

以下为示例，非仓库现状：

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

`throttled` / `throttleKey` 只由 `throttled*` 方法附加；其余条目的 `meta` 为 `{}`，或为子 Logger 传入 meta 的合并结果。

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

### 场景四：高频信息抑制

```js
// 缓冲区每次同步都打一条 info，但 200ms 内只记一次
log.throttledInfo("buffer-sync", `Buffer synced, ${chunks.length} chunks`);
```

## 级别说明

| 级别   | 值  | 生产 | 开发 | 说明                         |
| ------ | --- | ---- | ---- | ---------------------------- |
| DEBUG  | 0   | 关闭 | 开启 | 调试细节，高频时自适应降采样 |
| INFO   | 1   | 开启 | 开启 | 常规运行态信息               |
| WARN   | 2   | 开启 | 开启 | 非预期但可恢复的情况         |
| ERROR  | 3   | 开启 | 开启 | 需关注的问题                 |
| SILENT | 4   | —    | —    | 关闭所有日志                 |

表中「生产」「开发」两列为推荐配置，由调用方用 `setLevel` 设置；模块不按环境自动切换级别。

生产环境建议设为 `"WARN"`，仅输出警告和错误：

```js
log.setLevel(process.env.NODE_ENV === "production" ? "WARN" : "DEBUG");
```

## 相关文档

- [log-internals-document.md](./log-internals-document.md) — 架构与设计原理
