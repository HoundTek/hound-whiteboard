# 白板管理器文档

本文档提供 `BoardManager` 的概述。

`BoardManager` 是 Core 的白板级总控组件。一个白板文件在运行时应只对应一个 `BoardManager` 实例。

## 白板管理器职责

- 维护白板基础信息（宽、高、根目录）
- 维护页映射、页顺序与已加载页队列
- 管理全局活动对象管理器 `ActiveObjectManager`
- 管理历史树 `UndoTree`
- 提供白板加载、创建与对象写入接口

## 核心字段

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `undoTree` | 时间回溯树 | `UndoTree` |
| `activeObjectManager` | 活动对象管理器 | `ActiveObjectManager` |
| `pageMap` | 页 id 到页实例映射 | `Map<number, PageManager>` |
| `pageOrder` | 页顺序数组 | `number[]` |
| `loadedPages` | 已加载页队列 | `Deque` |
| `width`/`height` | 白板尺寸 | `number` |
| `root` | 白板根目录 | `Directory` |
| `pageCounterPool` | 页 id 池 | `CounterPool` |
| `objectCounterPool` | 对象 id 池 | `CounterPool` |

## 加载流程 `load(directory)`

当前实现流程：

1. 读取并校验 `meta.json` 与 `config.json`
2. 读取 `pages/connection.json`，恢复 `pageOrder` 与页 id 池
3. 基于 `pageOrder` 构建页链和 `pageMap`
4. 读取 `trace.json`（若缺失则默认第一页）
5. 加载当前页及相邻页到 `loadedPages`

该流程已经可作为白板运行时初始化骨架。

## 创建流程 `create(directory, boardInfo)`

当前行为：

- 初始化并尝试加载目标目录
- 写入白板元信息（`meta`、`config`）
- 创建/重建 `pages` 目录

后续计划（`todo`）：

- 创建完整文件结构
- 初始化第一页与模板

## 页面与对象操作

### `appendPage()`

- 使用 `pageCounterPool` 生成页 id
- 维护页链与页顺序
- 返回新页实例

当前仍待补：页文件创建、模板初始化、历史树记录。

### `addObject(obj, pageId)`

- 找到目标页
- 委托页管理器写入对象
- 页不存在时抛错

## API

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `load(directory)` | 加载白板 | `Directory -> BoardManager` |
| `appendPage()` | 追加新页 | `void -> PageManager` |
| `addObject(obj, pageId)` | 向指定页添加对象 | `BasicObject -> number -> void` |
| `create(directory, boardInfo)` | 创建白板（静态） | `Directory -> Object -> BoardManager` |

## 设计约束

- 页实例所有权归 `BoardManager`。
- 活动对象关系不直接写入页静态图，应通过活动对象管理器管理动态关系。
- 设备、工具、历史等高级状态最终应在白板加载阶段统一恢复。

## 实现状态

- 已实现：白板读取校验、页链恢复、邻页加载骨架、活动对象管理器/历史树挂载。
- 待完善：完整新建流程、对象计数池初始化、历史与设备状态恢复、页与对象全链路落盘。

## 相关文档

- [components-document.md](./components-document.md)
- [page-manager-document.md](./page-manager-document.md)
- [active-object-document.md](./active-object-document.md)
- [tire-graph-document.md](./tire-graph-document.md)
