# 笔画对象文档

本文档提供当前笔画对象族的概述，对应 `src/engine/objects/stroke/` 下的实现。

## `StrokeObject`

`StrokeObject` 定义于：

```text
src/engine/objects/stroke/stroke.js
```

它派生于 [BasicObject](../docs/basic-classes-document.md)，当前特征是：

- `isDirected()` 返回 `false`
- `isErasable()` 返回 `true`

也就是说，笔画对象当前被视为：

- 无向对象
- 可擦对象

## 当前核心数据

| 名称                   | 描述         |
| ---------------------- | ------------ |
| `data.points`          | 笔画路径点集 |
| `property.color`       | 笔画颜色     |
| `property.width`       | 笔画宽度     |
| `property.lineJoin`    | 拐角样式     |
| `property.lineCap`     | 端点样式     |
| `rich.localPathRange`  | 局部路径范围 |
| `rich.worldPathRange`  | 世界路径范围 |
| `rich.convexHullRange` | 凸包范围     |
| `rich.boundingBox`     | 包围盒       |

## 当前行为

- `_onDataChange()` 在 `points` 变化后重建路径范围与富数据
- `calculateRichDatas()` 会同步世界路径、凸包与包围盒
- `setTransform()` 会重算派生几何
- `getRange()` 返回 `worldPathRange`
- `serialize()` 追加 `type: "StrokeObject"`

## 当前约束

源码中已明确标注：当前 `StrokeObject` 结构还不支持更换笔刷，这部分仍属于后续重构空间。

## 相关文档

- [基础类型文档](../docs/basic-classes-document.md)
- [白板对象文档](../docs/board-classes-document.md)
