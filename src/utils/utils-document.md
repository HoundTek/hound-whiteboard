# utils 文档索引

本文档集整理 `src/utils/` 下运行时工具模块的职责与文档入口，并指引安全文件访问框架的位置。

## 文档列表

- [README.md](../io/README.md) — safe-io v4（Tauri 2 安全文件操作框架）
- [log-usage-document.md](./log/docs/log-usage-document.md) — 日志系统用法
- [log-internals-document.md](./log/docs/log-internals-document.md) — 日志系统内部原理

## 模块分组

- 安全文件访问框架（不在本目录）：`src/io/`（Tauri 2 / kernel / host 三端可用）
- 日志系统：`log/`
- 协作身份：`device-identity.js`、`short-id.js`（暂无单模块文档）

## 与 kernel utils 的边界

- `src/utils/` 负责应用级运行时工具（日志）。
- `src/kernel/utils/` 负责内核通用容器、数学工具和逻辑路径。

若你要查看队列、图结构、矩阵和逻辑路径，请转到 [../kernel/utils/docs/utils-document.md](../kernel/utils/docs/utils-document.md)。

## 使用建议

- 若处理 capability、安全边界、权限验证和受控文件访问，优先阅读 [README.md](../io/README.md)。
- 若要使用日志记录或搭建日志消费者，优先阅读 [log-usage-document.md](./log/docs/log-usage-document.md)。
- 若要理解日志系统的架构和设计原理，优先阅读 [log-internals-document.md](./log/docs/log-internals-document.md)。
