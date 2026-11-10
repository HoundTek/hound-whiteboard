# 白板对象文档

本文档提供当前白板对象族的概览，重点对应 `src/kernel/objects/` 下已经存在的模块。

## 概述

当前对象体系主要可以分成几类：

- **基础根类**：`BasicObject`
- **图形对象族**：`GraphObject`、`CircleObject`、`EllipseObject`、`PolygonObject`
- **笔画对象族**：`StrokeObject`

这些对象最终都围绕统一的：

- `id`
- `position`
- `transform`
- `property`
- `data`
- `rich`

来组织。

## 图形对象族

图形对象相关模块位于：

```text
src/kernel/objects/graph/
```

它们的共同特征是：

- 派生自 `BasicObject`
- `isDirected()` 返回 `true`
- `isErasable()` 返回 `false`

详见 [图形对象文档](./graph-classes-document.md)。

## 笔画对象族

笔画对象当前主要由：

- `StrokeObject`

构成，定义于：

```text
src/kernel/objects/stroke/stroke.js
```

它的主要特征是：

- 派生自 `BasicObject`
- `isDirected()` 返回 `false`
- `isErasable()` 返回 `true`
- `eraseData(trailPoints, radius)` 按橡皮轨迹返回剩余点段（`null` 未命中、空数组整笔擦没），供 Core 侧分流回写 / 分裂 / 删除

详见 [笔画对象文档](./stroke-classes-document.md)。

## 对象持久化

白板对象在持久化时，应先调用具体对象实例的 `serialize()` 生成普通 JSON 对象；恢复时，统一使用：

```text
src/kernel/objects/object-deserializer.js
```

中的 `deserialize()`。

序列化数据须含 `type` 字符串（如 `"CircleObject"`），由 `parserRegistry` 分派；新增类型用同模块 `registerDeserializer(type, parser)` 注册。

这样可以把对象类型分发逻辑收敛在一处，避免业务层散落 `if/else` 或 `switch(type)`。

## 当前状态

- 统一反序列化入口已接通 CircleObject / EllipseObject / PolygonObject / StrokeObject

## 相关文档

- [基础类型文档](./basic-classes-document.md)
- [图形对象文档](./graph-classes-document.md)
- [笔画对象文档](./stroke-classes-document.md)
