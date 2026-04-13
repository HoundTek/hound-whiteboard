# utils 文档索引

本文档集整理 `src/utils/` 下通用工具模块的职责、核心数据结构与使用方式。

## 文档列表

- [algorithm-document.md](./docs/algorithm-document.md)
- [deque-document.md](./docs/deque-document.md)
- [queue-document.md](./docs/queue-document.md)
- [math-document.md](./docs/math-document.md)
- [math3d-document.md](./docs/math3d-document.md)
- [io-document.md](./filesys/docs/io-document.md)
- [io-for-renderer.md](./filesys/docs/io-for-renderer.md)
- [io-file-granularity.md](./filesys/docs/io-file-granularity.md)
- [file-block-document.md](./filesys/docs/file-block-document.md)
- [chain-document.md](./docs/chain-document.md)

## 模块分组

- 数学与几何：`math.js`、`math3d.js`
- 容器结构：`queue.js`、`deque.js`、`chain.js`
- 文件与路径：`io.js`
- 通用算法：`algorithm.js`

## 使用建议

- 若处理二维坐标、矩阵与变换，优先阅读 [math-document.md](./docs/math-document.md)。
- 若处理页缓冲区、遍历队列等场景，优先阅读 [queue-document.md](./docs/queue-document.md) 与 [deque-document.md](./docs/deque-document.md)。
- 若处理白板文件结构、目录读写与随机文件名，优先阅读 [io-document.md](./filesys/docs/io-document.md)。
- 若处理渲染进程内的文件访问、IPC 桥接或批量 I/O，优先阅读 [io-for-renderer.md](./filesys/docs/io-for-renderer.md)。
- 若优化文件存储结构以获得最佳 I/O 性能（如确定单个文件大小和数量），优先阅读 [io-file-granularity.md](./filesys/docs/io-file-granularity.md)。
- 若要在 8KB~16KB 目标下进行块分配、分裂与合并，优先阅读 [file-block-document.md](./filesys/docs/file-block-document.md)。