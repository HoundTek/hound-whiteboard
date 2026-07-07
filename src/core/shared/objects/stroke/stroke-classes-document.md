# 笔画对象文档

本文档提供各种笔画对象的概述。

## Stroke Object

StrokeObject 类是白板上的所有笔画对象的基类。故名思义，笔画对象就像现实里的一笔一划一样，是用笔工具“画”出来的。

它是可擦的无向对象。派生于 [BasicObject](../basic-classes-document.md#basic-object)

### 属性

| 名称                   | 描述                   | 类型                         |
| ---------------------- | ---------------------- | ---------------------------- |
| `data.points`          | 笔画路径点集           | `{ x: number, y: number }[]` |
| `rich.localPathRange`  | 笔画对象的局部路径范围 | `PathRange`                  |
| `rich.worldPathRange`  | 笔画对象的世界路径范围 | `PathRange`                  |
| `rich.convexHullRange` | 笔画对象的凸包范围     | `PolygonRange`               |
| `rich.boundingBox`     | 笔画对象的包围盒       | `RectangleRange`             |
| `property.color`       | 笔画颜色               | `string`                     |
| `property.width`       | 笔画宽度               | `number`                     |
