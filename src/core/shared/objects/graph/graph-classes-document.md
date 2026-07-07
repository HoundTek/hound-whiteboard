# 图形对象文档

本文档提供当前图形对象族的概述，对应 `src/core/shared/objects/graph/` 下的实现。

## 概述

当前图形对象族主要包括：

- `GraphObject`
- `CircleObject`
- `PolygonObject`

它们都属于 **不可擦、可定向** 的图形对象。

## `GraphObject`

`GraphObject` 定义于：

```text
src/core/shared/objects/graph/graph.js
```

它派生于 [BasicObject](../docs/basic-classes-document.md)，并统一约定：

- `isDirected()` 返回 `true`
- `isErasable()` 返回 `false`

也就是说，图形对象默认被视为：

- 有向对象
- 不可擦对象

## `CircleObject`

`CircleObject` 定义于 `circle.js`。

### 当前核心数据

| 名称                   | 描述         |
| ---------------------- | ------------ |
| `data.radius`          | 圆半径       |
| `property.fillColor`   | 填充色       |
| `property.strokeColor` | 描边色       |
| `property.strokeWidth` | 描边宽度     |
| `rich.convexHullRange` | 椭圆凸包范围 |
| `rich.boundingBox`     | 边界矩形     |

### 当前行为

- `getRange()` 返回变换后的 `EllipseRange`
- `_onDataChange()` 在 `radius` 变化后更新凸包与边界矩形
- `serialize()` 追加 `type: "CircleObject"`

## `PolygonObject`

`PolygonObject` 定义于 `polygon.js`。

### 当前核心数据

| 名称                     | 描述               |
| ------------------------ | ------------------ |
| `data.points`            | 多边形顶点集       |
| `property.fillColor`     | 填充色             |
| `property.strokeColor`   | 描边色             |
| `property.strokeWidth`   | 描边宽度           |
| `rich.localPolygonRange` | 局部多边形范围     |
| `rich.worldPolygonRange` | 世界坐标多边形范围 |
| `rich.convexHullRange`   | 凸包范围           |
| `rich.boundingBox`       | 包围盒             |

### 当前行为

- `_onDataChange()` 在 `points` 变化后更新局部/世界范围、凸包与包围盒
- `setTransform()` 会同步更新 `worldPolygonRange`
- `getRange()` 返回 `worldPolygonRange`
- `serialize()` 追加 `type: "PolygonObject"`

## 当前状态

- `GraphObject` 已作为图形对象族公共基类落地
- `CircleObject` 与 `PolygonObject` 已接入统一反序列化入口
- `graph3d.js` 仍不是当前主交互链路中的稳定对象类型，应视为预留或扩展模块

## 相关文档

- [基础类型文档](../docs/basic-classes-document.md)
- [白板对象文档](../docs/board-classes-document.md)
