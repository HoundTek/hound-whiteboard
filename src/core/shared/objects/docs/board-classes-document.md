# 白板对象文档

本文档提供当前白板对象族的概览，重点对应 `src/core/shared/objects/` 下已经存在的模块。

## 概述

当前对象体系主要可以分成几类：

- **基础根类**：`BasicObject`
- **容器/维度骨架**：`Container`、`OneDimensionObject`、`TwoDimensionObject`
- **图形对象族**：`GraphObject`、`CircleObject`、`PolygonObject`
- **笔画对象族**：`StrokeObject`

这些对象最终都围绕统一的：

- `id`
- `position`
- `transform`
- `property`
- `data`
- `rich`

来组织。

## `Container`

`Container` 定义在：

```text
src/core/shared/objects/container.js
```

它派生于 [BasicObject](./basic-classes-document.md)，并引入 `ContainerMode` 概念。

### 当前实现状态

当前 `Container` 代码层主要提供：

- `mode`
- `ContainerMode.NORMAL`
- `ContainerMode.STRETCH`
- `ContainerMode.WINDOW`
- `ContainerMode.SHRINK`

需要特别说明：

- 文档层常见的“容器包裹子对象、进入容器编辑内部对象”等 richer 语义，当前并没有在 `container.js` 中完整实现为运行时代码
- 因此更适合把它理解为**对象族层级骨架 + 容器模式概念承载**

## 一维 / 二维对象骨架

### `OneDimensionObject`

定义于：

```text
src/core/shared/objects/one-dim/one-dim-obj.js
```

当前在 `Container` 基础上增加：

- `ihatLength`
- `ihatRotate`

### `TwoDimensionObject`

定义于：

```text
src/core/shared/objects/two-dim/two-dim-obj.js
```

当前主要作为二维对象的类型骨架存在。

## 图形对象族

图形对象相关模块位于：

```text
src/core/shared/objects/graph/
```

当前核心成员：

- `GraphObject`
- `CircleObject`
- `PolygonObject`

它们的共同特征是：

- 派生自 `BasicObject`
- `isDirected()` 返回 `true`
- `isErasable()` 返回 `false`

详见 [图形对象文档](../graph/graph-classes-document.md)。

## 笔画对象族

笔画对象当前主要由：

- `StrokeObject`

构成，定义于：

```text
src/core/shared/objects/stroke/stroke.js
```

它的主要特征是：

- 派生自 `BasicObject`
- `isDirected()` 返回 `false`
- `isErasable()` 返回 `true`

详见 [笔画对象文档](../stroke/stroke-classes-document.md)。

## 对象持久化

白板对象在持久化时，应先调用具体对象实例的 `serialize()` 生成普通 JSON 对象；恢复时，统一使用：

```text
src/core/shared/objects/object-deserializer.js
```

中的 `deserialize()`。

这样可以把对象类型分发逻辑收敛在一处，避免业务层散落 `if/else` 或 `switch(type)`。

## 当前状态

- `BasicObject`、`GraphObject`、`CircleObject`、`PolygonObject`、`StrokeObject` 都已有明确运行时代码
- `Container`、`OneDimensionObject`、`TwoDimensionObject` 当前更多承担对象族层级骨架与概念角色
- 统一反序列化入口已接通 Circle / Polygon / Stroke

## 相关文档

- [基础类型文档](./basic-classes-document.md)
- [图形对象文档](../graph/graph-classes-document.md)
- [笔画对象文档](../stroke/stroke-classes-document.md)
