# 页面类文档

本文档提供 `Page` 的概述。

`Page` 是单页生命周期管理单元，负责维护页 id、由 id 推导出的二维坐标，以及协调本页对象管理器的加载与卸载。

## 页面类职责

- 管理页对象管理器 `objectManager`
- 维护页唯一标识：`id`
- 维护由 `id` 推导出的二维坐标：`x` 与 `y`
- 提供完整加载、临时加载、卸载、临时卸载接口
- 提供页身份合法性校验接口

## 核心字段

| 名称            | 描述           | 类型                |
| --------------- | -------------- | ------------------- |
| `id`            | 页唯一标识     | `number`            |
| `x`             | 页二维坐标 x   | `number`            |
| `y`             | 页二维坐标 y   | `number`            |
| `objectManager` | 页对象管理器   | `PageObjectManager` |
| `isLoad`        | 是否已加载     | `boolean`           |
| `isTempLoad`    | 是否为临时加载 | `boolean`           |

## 页 id 与坐标

当前实现以页 id 作为页实体的主描述。二维坐标是由 id 推导出来的空间属性：

- `Page.idToCoordinate(id)`：将正整数页 id 换算为二维坐标
- `Page.coordinateToId(x, y)`：将二维坐标换算为页 id
- `Page.isValidPageIdentity(id, x, y)`：判断页 id 与坐标是否匹配
- `page.isValid()`：判断页实例自身是否合法

其中：

- `1` 对应原点 `(0, 0)`
- 后续 id 按回字形向外扩展
- 同一个坐标只对应唯一一个页 id
- 同一个页 id 也只对应唯一一组坐标

## 加载模型

### 临时加载 `loadTemp(boardRootPath)`

临时加载只加载层叠关系（tier graph），不加载全部对象内容。用于活动对象跨页拾取等场景，减少内存占用。

### 完整加载 `loadFull(boardRootPath)`

当前流程：

1. 若已完整加载，直接返回
2. 若未加载，先执行临时加载
3. 计划继续加载对象内容（当前仍为 `todo`）

### 降级 `downgradeToTemp()`

当某页已经完整加载，但之后只剩下“临时加载需求”时，可以从完整加载降级为临时加载。

当前设计目标：

- 保留层叠图
- 卸载完整对象内容
- 保持页处于 `isLoad = true` 且 `isTempLoad = true` 的状态

### 卸载 `unload()` / `unloadTemp()`

- `unload()`：释放页对象管理器与当前内容引用。
- `unloadTemp()`：仅允许临时加载状态下调用，当前实现复用完整卸载路径。

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

| 名称                            | 描述                     | 类型                                     |
| ------------------------------- | ------------------------ | ---------------------------------------- |
| `idToCoordinate(id)`            | id 转二维坐标            | `number -> { x: number, y: number }`     |
| `coordinateToId(x, y)`          | 二维坐标转 id            | `number -> number -> number`             |
| `isValidPageIdentity(id, x, y)` | 判断页 id 与坐标是否匹配 | `number -> number -> number -> boolean`  |
| `addObject(obj, below, above)`  | 按上下关系加入对象       | `number -> number[] -> number[] -> void` |
| `loadFull(boardRootPath)`       | 完整加载页面             | `string -> Promise<boolean>`             |
| `loadTemp(boardRootPath)`       | 临时加载页面             | `string -> Promise<boolean>`             |
| `downgradeToTemp()`             | 从完整加载降级为临时加载 | `void -> boolean`                        |
| `unload()`                      | 完整卸载页面             | `void -> void`                           |
| `unloadTemp()`                  | 临时卸载页面             | `void -> boolean`                        |

## 实现状态

- 已实现：二维坐标与 id 的双向换算、按需实例化的页实体、临时加载与临时卸载接口、完整加载到临时加载的降级入口、静态图基础加边。
- 待完善：对象完整加载/保存、完整卸载细节、自动相交分析、更高层的二维导航策略。

## 相关文档

- [page-object-manager-document.md](./page-object-manager-document.md)
- [board-document.md](./board-document.md)
- [tier-graph-document.md](./tier-graph-document.md)
