# 页面对象管理器文档

本文档提供 `PageObjectManager` 的概述。

`PageObjectManager` 负责管理单页内对象数据与对象层叠关系（静态图），是页级数据读写与层关系维护的核心组件。

## 何为页面对象管理

页面对象管理包含两部分：

1. 本页对象实例映射（拥有对象实例所有权）
2. 本页对象层叠关系图（仅存对象 id 关系）

这两部分相互配合：

- 图决定对象间遮挡/上下文关系
- 对象映射决定对象本身内容（几何、样式、渲染属性）

## 核心字段

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `staticGraph` | 页静态层叠图 | `DirectedGraph` |
| `coverLeftPage` | 向左跨页对象集合 | `Set<number>` |
| `coverRightPage` | 向右跨页对象集合 | `Set<number>` |
| `pageObjects` | 页对象映射 | `Map<number, BasicObject>` |

其中 `coverLeftPage` 和 `coverRightPage` 用于标记对象是否与邻页存在关联，以支持跨页拾取。

## 层叠图接口

### `loadTierGraph(file)`

从文件反序列化静态图：

- 输入结构由 `DirectedGraph.parse(...)` 处理
- 当前实现会直接替换 `staticGraph`

### `saveTierGraph(file)`

用于持久化静态图，当前为 `todo`。

### `unloadTierGraph()`

释放静态图引用，供临时页卸载使用。

## 对象读写接口

- `loadObjects(directory)`：加载本页对象（`todo`）
- `saveObjects(directory)`：保存本页对象（`todo`）
- `unloadObjects()`：释放对象实例（`todo`）
- `unload()`：统一卸载（`todo`）

## API

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `loadTierGraph(file)` | 加载页层叠图 | `File -> void` |
| `saveTierGraph(file)` | 保存页层叠图 | `File -> void` |
| `unloadTierGraph()` | 卸载页层叠图 | `void -> void` |
| `loadObjects(directory)` | 加载页对象 | `Directory -> void` |
| `saveObjects(directory)` | 保存页对象 | `Directory -> void` |
| `unloadObjects()` | 卸载页对象 | `void -> void` |
| `unload()` | 卸载本页全部数据 | `void -> void` |

## 与其它组件的关系

- 被 [page-manager-document.md](./page-manager-document.md) 持有并调度。
- 其静态图被 [active-object-document.md](./active-object-document.md) 的跨页拾取逻辑读取。
- 底层依赖 `src/core/utils/directed-graph.js`。

## 实现状态

- 已实现：数据结构定义、层叠图加载与卸载。
- 待完善：图保存、对象读写、统一卸载流程。
