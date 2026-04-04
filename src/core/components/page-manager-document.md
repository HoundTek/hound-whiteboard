# 页面管理器文档

本文档提供 `PageManager` 的概述。

`PageManager` 是单页生命周期管理单元，负责维护页链关系，并协调本页对象管理器的加载与卸载。

## 页面管理器职责

- 管理页对象管理器 `objectManager`
- 维护页链：`prevPage` 与 `nextPage`
- 提供完整加载、临时加载、卸载、临时卸载接口

## 核心字段

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `id` | 页 id | `number` |
| `objectManager` | 页对象管理器 | `PageObjectManager` |
| `nextPage` | 后一页 | `PageManager \| undefined` |
| `prevPage` | 前一页 | `PageManager \| undefined` |
| `isLoad` | 是否已加载 | `boolean` |
| `isTempLoad` | 是否为临时加载 | `boolean` |

## 页链逻辑

通过静态方法 `connectTwoPage(first, second)` 连接两页。该方法通过修改两页的 `nextPage` 和 `prevPage` 来实现页连接，类似于链表。

页链用于翻页、跨页拾取和邻页预加载。

## 加载模型

### 临时加载 `loadTemp(directory)`

临时加载只加载层叠关系（tier graph），不加载全部对象内容。用于活动对象跨页拾取等场景，减少内存占用。

### 完整加载 `load(directory)`

当前流程：

1. 若已完整加载，直接返回
2. 若未加载，先执行临时加载
3. 计划继续加载对象内容（当前仍为 `todo`）

### 卸载 `unload()` / `unloadTemp()`

- `unload()`：计划完整释放页资源（当前保留 `todo`）。
- `unloadTemp()`：仅允许临时加载状态下调用，卸载层叠图。

## 对象加入接口

### `addObject(obj, below, above)`

将对象按上下关系连接到本页静态图：

- 对每个 `below` 节点加边 `below -> obj`
- 对每个 `above` 节点加边 `obj -> above`

不存在于本页静态图的节点会被跳过（视为跨页对象）。

### `addNewObject(obj)`

当前已做：向静态图增加节点。

计划待做：

- 计算与现有对象的相交关系
- 自动生成初始层叠边

## API

| 名称 | 描述 | 类型 |
|:--|:--|:--|
| `connectTwoPage(first, second)` | 连接两页 | `PageManager -> PageManager -> void` |
| `addObject(obj, below, above)` | 按上下关系加入对象 | `number -> number[] -> number[] -> void` |
| `loadFull(directory)` | 完整加载页面 | `Directory -> boolean` |
| `loadTemp(directory)` | 临时加载页面 | `Directory -> boolean` |
| `unload()` | 完整卸载页面 | `void -> void` |
| `unloadTemp()` | 临时卸载页面 | `void -> boolean` |

## 实现状态

- 已实现：页链结构、临时加载与临时卸载接口、静态图基础加边。
- 待完善：对象完整加载/保存、完整卸载、自动相交分析。

## 相关文档

- [page-object-manager-document.md](./page-object-manager-document.md)
- [board-manager-document.md](./board-manager-document.md)
- [tier-graph-document.md](./tier-graph-document.md)
