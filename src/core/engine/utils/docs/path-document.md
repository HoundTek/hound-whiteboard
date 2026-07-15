# path 文档

本文档提供 `src/engine/utils/path.js` 的概述。

## 模块职责

`path.js` 提供 Core 层内部使用的逻辑路径工具。

这里的路径不是操作系统文件路径，而是设备图、事件路由和运行时节点使用的统一绝对路径表示，例如 `/viewport/keyboard/code/Space`。

## 路径表示约定

- 根路径表示为 `/`
- 内部片段数组不包含根节点本身
- 输出统一使用 `/` 作为分隔符
- 空片段和多余斜杠会在规整阶段被清理

## API

| 名称                                           | 描述                               | 类型                         |
| ---------------------------------------------- | ---------------------------------- | ---------------------------- |
| `normalizePath(path = "/")`                    | 将路径规整为片段数组               | `(string) => string[]`       |
| `toAbsolutePath(segments = [])`                | 将片段数组转回绝对路径             | `(string[]) => string`       |
| `joinPath(...parts)`                           | 拼接多个路径段并输出绝对路径       | `(string[]) => string`       |
| `resolvePath(basePath = "/", targetPath = "")` | 在基准路径上解析相对路径或绝对路径 | `(string, string) => string` |

## 行为特点

- `normalizePath()` 会去除空片段、空白字符和多余斜杠。
- `toAbsolutePath([])` 会回到根路径 `/`。
- `joinPath()` 不区分输入片段是否带前后斜杠，输出始终规整。
- `resolvePath()` 支持 `.` 和 `..` 相对片段，也支持直接传入绝对目标路径。

## 与文件系统路径的边界

该模块只服务于 Core 内部逻辑路径，不处理：

- 平台相关分隔符
- 磁盘盘符或绝对文件系统路径
- 文件扩展名、目录存在性或规范化大小写

这部分职责应由 `src/utils/filesys/` 或 Node.js 路径工具承担。

## 在仓库中的典型用途

- 设备图节点路径拼接
- 输入信号路由目标解析
- 视口和键盘设备的运行时节点命名

## 相关文档

- [utils-document.md](./utils-document.md)
- [event-bus-document.md](./event-bus-document.md)
