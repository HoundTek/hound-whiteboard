# 基础类型文档

本文档提供白板中基础对象类型的概述，重点对应当前 `src/core/shared/objects/` 下的实现。

## 模块概览

当前这组基础对象模块主要包括：

- `basic-obj.js`：`BasicObject`
- `container.js`：`Container` / `ContainerMode`
- `one-dim/one-dim-obj.js`：`OneDimensionObject`
- `two-dim/two-dim-obj.js`：`TwoDimensionObject`

其中真正被当前图形与笔画对象直接复用的基础类是 `BasicObject`。

## `BasicObject`

`BasicObject` 是白板上所有基础对象的根类。

它统一定义了：

- 对象 id
- 世界坐标位置 `position`
- 变换矩阵 `transform`
- 持久化数据 `data`
- 运行时富数据 `rich`
- 判定范围、凸包、边界矩形等统一接口

### 核心字段

| 名称        | 描述                     | 类型                  |
| ----------- | ------------------------ | --------------------- |
| `id`        | 对象 id                  | `number`              |
| `position`  | 对象世界坐标位置         | `Vector`              |
| `transform` | 对象变换矩阵             | `Matrix`              |
| `property`  | 渲染与行为属性字典       | `Record<string, any>` |
| `data`      | 对象类型专属的持久化数据 | `Record<string, any>` |
| `rich`      | 运行时派生富数据         | `Record<string, any>` |

### 关键接口

| 名称                                | 描述                                         |
| ----------------------------------- | -------------------------------------------- |
| `setData(data)`                     | 合并持久化数据，并触发 `_onDataChange(keys)` |
| `appendListItem(key, ...items)`     | 向列表型字段追加一项或多项                   |
| `replaceListItem(key, index, item)` | 替换列表型字段中指定索引的项                 |
| `removeListItem(key, index)`        | 删除列表型字段中的某一项                     |
| `_onDataChange(keys)`               | 数据变更回调，供子类重算派生结构             |
| `setTransform(matrix)`              | 设置变换矩阵并重算边界                       |
| `applyTransform(matrix)`            | 在当前变换上再乘一个新矩阵                   |
| `calculateRectangle()`              | 计算边界矩形                                 |
| `calculateConvexHull()`             | 计算凸包                                     |
| `getRange()`                        | 获取主判定范围                               |
| `setProperty(property)`             | 合并属性                                     |
| `getRenderPadding()`                | 从属性动态推导渲染留白                       |
| `isErasable()`                      | 是否可擦                                     |
| `isDirected()`                      | 是否有向                                     |
| `render(ctx)`                       | 渲染对象                                     |
| `serialize()`                       | 序列化对象                                   |
| `static parse(obj)`                 | 从序列化数据恢复对象                         |

### `data` 与 `rich`

当前对象数据分为两层：

- **`data`**：参与持久化的原始数据
- **`rich`**：运行时从 `data`、`transform` 推导出的派生结构

例如：

- `CircleObject.data.radius`
- `PolygonObject.data.points`
- `StrokeObject.data.points`

以及：

- `rich.boundingBox`
- `rich.convexHullRange`
- `rich.worldPathRange`

### 数据变更约束

不要直接修改 `this.data` 或 `this.rich` 的子字段。

应优先使用：

- `setData()`
- `appendListItem()`
- `replaceListItem()`
- `removeListItem()`

这样子类才能通过 `_onDataChange(keys)` 正确同步派生数据。

### 序列化约定

`BasicObject.serialize()` 当前会返回通用骨架：

- `id`
- `position`
- `transform`
- `property`
- `data`

具体子类会在此基础上追加 `type`，例如：

- `CircleObject` → `type: "CircleObject"`
- `PolygonObject` → `type: "PolygonObject"`
- `StrokeObject` → `type: "StrokeObject"`

## 统一反序列化入口

当前统一反序列化入口位于：

```text
src/core/shared/objects/object-deserializer.js
```

对应导出：

- `deserialize(data)`
- `registerDeserializer(type, parser)`

推荐业务代码统一使用 `deserialize()`，而不是手写 `switch(type)`。

当前已注册到默认反序列化表的类型有：

- `PolygonObject`
- `StrokeObject`
- `CircleObject`

## `Container` / `OneDimensionObject` / `TwoDimensionObject`

这三个类更多保留为对象族层级的基础骨架：

- `Container`：定义容器对象与 `ContainerMode`
- `OneDimensionObject`：在 `Container` 上增加 `ihatLength` / `ihatRotate`
- `TwoDimensionObject`：二维对象骨架

需要注意：

- `Container` 当前代码中主要实现了 `mode` 与 `ContainerMode`
- 更丰富的“容器包裹子对象”语义目前仍偏概念层，不应在文档中写成当前完整实现能力

## 当前状态

- `BasicObject` 是当前对象体系最稳定的公共根类
- `deserialize()` 已接通 Circle / Polygon / Stroke 三类对象
- Container / 一维 / 二维对象基类仍主要承担类型层级与概念承载作用

## 相关文档

- [白板对象文档](./board-classes-document.md)
- [图形对象文档](../graph/graph-classes-document.md)
- [笔画对象文档](../stroke/stroke-classes-document.md)
