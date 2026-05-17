# 笔画对象文档

本文档提供各种笔画对象的概述。

## Stroke Object

StrokeObject 类是白板上的所有笔画对象的基类。故名思义，笔画对象就像现实里的一笔一划一样，是用笔工具“画”出来的。

它是可擦的无向对象。派生于 [BasicObject](../basic-classes-document.md#basic-object)

### 属性

| 名称              | 描述                   | 类型             |
| ----------------- | ---------------------- | ---------------- |
| `localPathRange`  | 笔画对象的局部路径范围 | `PathRange`      |
| `worldPathRange`  | 笔画对象的世界路径范围 | `PathRange`      |
| `convexHullRange` | 笔画对象的凸包范围     | `PolygonRange`   |
| `boundingBox`     | 笔画对象的包围盒       | `RectangleRange` |
| `color`           | 笔画对象的颜色         | `string`         |

> `localPathRange` 表示对象局部坐标系下的原始笔迹路径。
>
> `worldPathRange` 表示应用当前变换后、用于渲染和命中的路径。
