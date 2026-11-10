# 笔画对象文档

本文档提供当前笔画对象族的概述，对应 `src/kernel/objects/stroke/` 下的实现。

## `StrokeObject`

`StrokeObject` 定义于：

```text
src/kernel/objects/stroke/stroke.js
```

它派生于 [BasicObject](./basic-classes-document.md)，当前特征是：

- `isDirected()` 返回 `false`（无向对象）
- `isErasable()` 返回 `true`（可擦对象）

## 当前核心数据

| 名称                   | 描述         | 坐标系   | 默认值    |
| ---------------------- | ------------ | -------- | --------- |
| `data.points`          | 笔画路径点集 | 局部坐标 | —         |
| `property.color`       | 笔画颜色     | —        | `#000000` |
| `property.width`       | 笔画宽度     | —        | `1`       |
| `property.lineJoin`    | 拐角样式     | —        | `round`   |
| `property.lineCap`     | 端点样式     | —        | `round`   |
| `rich.localPathRange`  | 局部路径范围 | 局部坐标 | —         |
| `rich.worldPathRange`  | 世界路径范围 | 世界坐标 | —         |
| `rich.convexHullRange` | 凸包范围     | 局部坐标 | —         |
| `rich.boundingBox`     | 包围盒       | 世界坐标 | —         |

## 当前行为

- `_onDataChange()` 在 `points` 变化后重建路径范围与富数据
- `calculateRichDatas()` 会同步世界路径、凸包与包围盒
- `setTransform()` 是修改 `transform` 的唯一入口；不经过它直接改 `transform` 不会刷新 `worldPathRange`、`convexHullRange`、`boundingBox`（`_onDataChange()` 不监听 transform）
- `getRange()` 返回 `worldPathRange`
- `eraseData(trailPoints, radius)` 逐线段判定擦除命中，`trailPoints` 为世界坐标
  - 阈值 = 橡皮半径 + 笔画世界宽度的一半；宽度随 transform 缩放，按 `sqrt(|det|)` 折算到世界坐标
  - 被擦线段剔除后，连续未擦线段聚合为点段返回；返回值为 `data.points` 的局部坐标切片，可直接写回。三种情况：`null` 表示未命中，`[]` 表示整笔擦没，多个点段表示笔画分裂
  - Core 侧按返回的段数分流：一段回写首段，多段各自新增为独立对象，零段删除整笔
- `serialize()` 追加 `type: "StrokeObject"`

## 当前约束

源码中已明确标注：当前 `StrokeObject` 结构还不支持更换笔刷，这部分仍属于后续重构空间。

## 相关文档

- [基础类型文档](./basic-classes-document.md)
- [白板对象文档](./board-classes-document.md)
