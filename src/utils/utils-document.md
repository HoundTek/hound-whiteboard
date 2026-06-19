# utils 文档索引

本文档集整理 `src/utils/` 下与文件系统、安全 I/O 和运行时文件访问相关模块的职责与文档入口。

## 文档列表

- [io-document.md](./filesys/docs/io-document.md)
- [io-for-renderer.md](./filesys/docs/io-for-renderer.md)
- [io-file-granularity.md](./filesys/docs/io-file-granularity.md)
- [file-block-document.md](./filesys/docs/file-block-document.md)
- [README.md](./safe-io/README.md)
- [log-usage-document.md](./log/docs/log-usage-document.md) — 日志系统用法
- [log-internals-document.md](./log/docs/log-internals-document.md) — 日志系统内部原理

## 模块分组

- 文件抽象与块存储：`filesys/`
- 安全文件访问框架：`safe-io/`
- 日志系统：`log/`

## 与 Core utils 的边界

- `src/utils/` 负责文件系统、块存储、渲染进程 I/O 桥接与安全访问。
- `src/core/utils/` 负责 Core 运行时通用容器、数学工具和逻辑路径。

若你要查看队列、双端队列、图结构、矩阵和逻辑路径，请转到 [../core/utils/docs/utils-document.md](../core/utils/docs/utils-document.md)。

## 使用建议

- 若处理白板文件结构、目录读写与随机文件名，优先阅读 [io-document.md](./filesys/docs/io-document.md)。
- 若处理渲染进程内的文件访问、IPC 桥接或批量 I/O，优先阅读 [io-for-renderer.md](./filesys/docs/io-for-renderer.md)。
- 若优化文件存储结构以获得最佳 I/O 性能（如确定单个文件大小和数量），优先阅读 [io-file-granularity.md](./filesys/docs/io-file-granularity.md)。
- 若要在 8KB~16KB 目标下进行块分配、分裂与合并，优先阅读 [file-block-document.md](./filesys/docs/file-block-document.md)。
- 若处理 capability、安全边界、权限验证和受控文件访问，优先阅读 [README.md](./safe-io/README.md)。
- 若要使用日志记录或搭建日志消费者，优先阅读 [log-usage-document.md](./log/docs/log-usage-document.md)。
- 若要理解日志系统的架构和设计原理，优先阅读 [log-internals-document.md](./log/docs/log-internals-document.md)。