# safe-io v4（src/io）

安全文件操作框架，Tauri 2 可用、kernel 可用、host 可用。

## 架构

```
src/io/
├── core/                  # 纯 JS 零依赖（任何 JS 运行时可用）
│   ├── dsl.js             # 路径 DSL：相对路径校验与规范化
│   └── policy.js          # 权限键、预设、操作映射与检查
├── driver/                # IoDriver 执行器契约 + 平台实现（全部 async）
│   ├── io-driver.js       # 契约 + OP 枚举 + bindRoot 绑定辅助
│   ├── memory.js          # 内存实现（测试 / headless / 预览）
│   ├── node.js            # Node fs 实现（CLI / jest / 独立工具）
│   └── tauri.js           # Tauri invoke → Rust commands（transport 可注入）
└── adapter/
    └── persistence.js     # PersistenceAdapter 契约（kernel 注入缝）
```

## 分层原则

- **core 零平台依赖**：不 import fs/path/electron，可在 webview、worker、node、Rust 旁任意运行。
- **IoDriver 是唯一的执行出口**：所有文件操作经驱动执行；驱动只处理 root 相对路径，不做权限判断。
- **安全判断下沉可信执行面**：Tauri 模式下 root 注册表、路径校验、符号链接边界与权限强制全部在 Rust（`src-tauri/src/commands/`）；webview/worker 只构造受限意图（rootId + relPath）。
- **不抛业务错误**：driver 失败返回 null/false/[]；Rust command 返回 `Err` 时 JS 驱动捕获转为安全值。

## Web / Worker 边界

- **无 Tauri 环境抛错**：`createTauriDriver()` 默认从 `window.__TAURI__` 解析 invoke；纯浏览器（web demo）等无 Tauri 环境下解析失败直接抛错（`tauri.js` 的 `getDefaultInvoke`），此时应注入自定义 transport 或换用 memory/node 驱动。
- **worker 内转发**：worker 线程没有主线程的 Tauri invoke。worker 内驱动注入转发 transport，把调用打包为 `io-invoke` 消息发给主线程；主线程由 `attachIoInvokeForwarder`（`src/host/bridges/io-invoke-forwarder.js`）监听，经 Tauri invoke 执行后回传 `io-response`。invoke 惰性解析：内存模式永不触发 `io-invoke`，无 Tauri 环境下挂接无害。

## 使用

生产两条路径（`src/cli/board-session.js`、`src/host/core-worker.js`）直接使用 driver + adapter：

```js
import { createTauriDriver } from "./driver/tauri.js";
import { createPersistenceAdapter } from "./adapter/persistence.js";

const driver = createTauriDriver();
const { rootId } = await driver.registerRoot(boardPath);
const adapter = createPersistenceAdapter({ driver, rootId });

const boardCore = new BoardCore({ persistenceAdapter: adapter, ... });
```

存储布局：`chunks/{chunkId}.json`、`objects/{encodeURIComponent(objectId)}.json`（与 session-store 同一命名，见 `src/docs/file-structure.md`）。

## Rust commands

`src-tauri/src/commands/`：`registry`（root 注册表 + resolve）、`fs`（读写/列目录/状态/删除/复制/移动/隐藏）、`zip`（压缩/解压/列表）。全部经 `resolve()` 做词法校验 + 符号链接边界检查 + 权限强制。

## 测试

- JS：`src/io/**/tests/*.test.js`（jest，覆盖 dsl/policy/memory/node/tauri/adapter）
- Rust：`src-tauri/src/commands/` 内 `#[cfg(test)]`（路径校验与 zip-slip 防护）
